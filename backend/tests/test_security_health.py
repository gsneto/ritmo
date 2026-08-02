from datetime import UTC, datetime, timedelta
from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

import database as database_module
from config import Settings
from database import Base, get_db, init_db
from main import create_app
from security import auth_failure_limiter, validate_api_key


def test_api_requires_configured_key_but_public_routes_do_not(client, auth_headers):
    assert client.get("/").status_code == 200
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert health.json()["timezone"] == "America/Sao_Paulo"
    assert health.json()["notifications"] == {
        "configured": False,
        "mode": "disabled",
        "status": "disabled",
        "last_cycle_at": None,
    }
    readiness = client.get("/ready")
    assert readiness.status_code == 200
    assert readiness.json()["status"] == "healthy"
    assert readiness.json()["database"] == "ready"
    assert readiness.json()["notifications"] == health.json()["notifications"]

    assert client.get("/api").status_code == 401
    assert client.get("/api/users").status_code == 401
    assert client.get("/api/users", headers={"X-Ritmo-Key": "wrong"}).status_code == 401
    assert client.get("/api", headers=auth_headers).status_code == 200
    protected_response = client.get("/api/users", headers=auth_headers)
    assert protected_response.status_code == 200
    assert protected_response.headers["cache-control"] == "no-store"
    assert protected_response.headers["x-content-type-options"] == "nosniff"
    assert protected_response.headers["x-frame-options"] == "DENY"
    assert protected_response.headers["referrer-policy"] == "no-referrer"


def test_missing_key_requires_explicit_local_sqlite_opt_out():
    with pytest.raises(ValidationError, match="APP_ACCESS_TOKEN is required"):
        Settings(
            _env_file=None,
            DEBUG=True,
            APP_ACCESS_TOKEN=None,
            ALLOW_INSECURE_NO_ACCESS_TOKEN=False,
            DATABASE_URL="sqlite://",
            CORS_ORIGINS="http://localhost:5173",
        )

    development = Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN=None,
        ALLOW_INSECURE_NO_ACCESS_TOKEN=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
    )
    assert validate_api_key(None, development, "development-test") is None

    with pytest.raises(ValidationError, match="only allowed with DEBUG=true and SQLite"):
        Settings(
            _env_file=None,
            DEBUG=False,
            APP_ACCESS_TOKEN=None,
            ALLOW_INSECURE_NO_ACCESS_TOKEN=True,
            DATABASE_URL="sqlite://",
            CORS_ORIGINS="https://ritmo.example",
        )

    with pytest.raises(ValidationError, match="only allowed with DEBUG=true and SQLite"):
        Settings(
            _env_file=None,
            DEBUG=True,
            APP_ACCESS_TOKEN=None,
            ALLOW_INSECURE_NO_ACCESS_TOKEN=True,
            DATABASE_URL="postgresql://user:secret@postgres.internal:5432/ritmo",
            CORS_ORIGINS="http://localhost:5173",
        )


def test_debug_defaults_to_false_and_local_development_is_explicit(monkeypatch):
    monkeypatch.delenv("RITMO_DEBUG", raising=False)
    defaults = Settings(
        _env_file=None,
        APP_ACCESS_TOKEN="configured-token",
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
    )

    assert defaults.DEBUG is False
    assert defaults.database_bootstrap_enabled is False

    development = Settings(
        _env_file=None,
        RITMO_DEBUG=True,
        APP_ACCESS_TOKEN=None,
        ALLOW_INSECURE_NO_ACCESS_TOKEN=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
    )
    assert development.DEBUG is True
    assert development.database_bootstrap_enabled is True


def test_production_startup_skips_schema_bootstrap_and_hides_docs():
    production = Settings(
        _env_file=None,
        DEBUG=False,
        APP_ACCESS_TOKEN="production-secret",
        DATABASE_URL="postgresql://user:secret@postgres.internal:5432/ritmo",
        CORS_ORIGINS="https://ritmo.example",
    )
    database_initializer = MagicMock()
    session = MagicMock()
    session_factory = MagicMock(return_value=session)

    with patch("main.seed_default_data"):
        production_app = create_app(
            production,
            database_initializer=database_initializer,
            session_factory=session_factory,
        )
        with TestClient(production_app) as client:
            assert client.get("/docs").status_code == 404
            assert client.get("/openapi.json").status_code == 404

    database_initializer.assert_not_called()
    session.close.assert_called_once()
    assert production_app.docs_url is None
    assert production_app.redoc_url is None
    assert production_app.openapi_url is None

    with pytest.raises(HTTPException) as error:
        validate_api_key("incorrect", production, "production-test")
    assert error.value.status_code == 401


def test_init_db_does_not_inspect_or_modify_postgresql(monkeypatch):
    postgresql_engine = SimpleNamespace(
        dialect=SimpleNamespace(name="postgresql"),
    )
    inspect_database = MagicMock()
    create_all = MagicMock()
    session_factory = MagicMock()
    monkeypatch.setattr(database_module, "inspect", inspect_database)
    monkeypatch.setattr(Base.metadata, "create_all", create_all)

    init_db(bind=postgresql_engine, session_factory=session_factory)

    inspect_database.assert_not_called()
    create_all.assert_not_called()
    session_factory.assert_not_called()


def test_repeated_invalid_keys_trigger_temporary_lockout(client, auth_headers):
    auth_failure_limiter.reset()
    try:
        rejected = [
            client.get("/api", headers={"X-Ritmo-Key": "wrong"})
            for _ in range(9)
        ]
        locked = client.get("/api", headers={"X-Ritmo-Key": "wrong"})
        valid_during_lockout = client.get("/api", headers=auth_headers)
    finally:
        auth_failure_limiter.reset()

    assert [response.status_code for response in rejected] == [401] * 9
    assert locked.status_code == 429
    assert locked.headers["retry-after"] == "300"
    assert valid_during_lockout.status_code == 429


def test_database_url_uses_pymysql_and_escapes_credentials():
    managed = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="mysql://user:secret@db.internal:3306/ritmo",
        CORS_ORIGINS="http://localhost:5173",
    )
    assert managed.database_url == (
        "mysql+pymysql://user:secret@db.internal:3306/ritmo"
    )

    composed = Settings(
        _env_file=None,
        DEBUG=True,
        DB_HOST="db.internal",
        DB_PORT=3306,
        DB_USER="user@example.com",
        DB_PASSWORD="p:a/ss word",
        DB_NAME="ritmo pessoal",
        CORS_ORIGINS="http://localhost:5173",
    )
    assert composed.database_url == (
        "mysql+pymysql://user%40example.com:p%3Aa%2Fss+word"
        "@db.internal:3306/ritmo%20pessoal"
    )


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        (
            "postgresql://user:secret@postgres.internal:5432/ritmo",
            "postgresql+psycopg://user:secret@postgres.internal:5432/ritmo",
        ),
        (
            "postgres://user:secret@postgres.internal:5432/ritmo",
            "postgresql+psycopg://user:secret@postgres.internal:5432/ritmo",
        ),
    ],
)
def test_database_url_uses_psycopg(database_url, expected):
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL=database_url,
        CORS_ORIGINS="http://localhost:5173",
    )

    assert settings.database_url == expected


def test_health_returns_503_when_database_query_fails(context):
    application = context.client.app

    class BrokenSession:
        def execute(self, _statement):
            raise RuntimeError("database offline")

    def broken_db():
        yield BrokenSession()

    application.dependency_overrides[get_db] = broken_db
    response = context.client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
    readiness = context.client.get("/ready")
    assert readiness.status_code == 503
    assert readiness.json()["status"] == "unhealthy"
    assert readiness.json()["database"] == "unavailable"
    assert "notifications" in readiness.json()


def test_health_degrades_when_embedded_push_worker_is_not_recent(
    context,
    settings,
    auth_headers,
    user_id,
):
    settings.VAPID_PUBLIC_KEY = "public-key-test"
    settings.VAPID_PRIVATE_KEY = SecretStr("private-key-test")
    state = context.client.app.state.push_worker_state
    state.mark_started()
    state.record_success(
        {"enqueued": 0, "processed": 0},
        at=datetime.now(UTC) - timedelta(minutes=10),
    )

    response = context.client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["notifications"]["status"] == "unavailable"
    readiness = context.client.get("/ready")
    assert readiness.status_code == 503
    assert readiness.json()["status"] == "unhealthy"
    assert readiness.json()["database"] == "ready"
    assert readiness.json()["notifications"]["status"] == "unavailable"
    config = context.client.get(
        f"/api/users/{user_id}/push-config",
        headers=auth_headers,
    ).json()
    assert config["delivery_mode"] == "embedded"
    assert config["delivery_status"] == "unavailable"
    assert config["last_cycle_at"] is not None


def test_lifespan_starts_and_stops_embedded_worker_without_blocking(
    tmp_path,
    monkeypatch,
):
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN="test-token",
        DATABASE_URL=f"sqlite:///{(tmp_path / 'embedded-worker.db').as_posix()}",
        CORS_ORIGINS="http://localhost:5173",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        PUSH_WORKER_POLL_SECONDS=5,
    )
    started = Event()
    stopped = Event()

    def fake_worker(*, stop_event, state, **_kwargs):
        state.mark_started()
        state.record_success({"enqueued": 0, "processed": 0})
        started.set()
        stop_event.wait(2)
        state.mark_stopped()
        stopped.set()
        return 0

    monkeypatch.setattr("main.run_worker", fake_worker)
    application = create_app(settings)

    with TestClient(application) as test_client:
        assert started.wait(timeout=1)
        response = test_client.get("/health")
        assert response.json()["notifications"]["status"] == "ready"
        readiness = test_client.get("/ready")
        assert readiness.status_code == 200
        assert readiness.json()["status"] == "healthy"

    assert stopped.wait(timeout=1)
    assert application.state.push_worker_state.snapshot()["running"] is False


def test_cors_uses_configured_origin(client):
    response = client.options(
        "/api/users",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-Ritmo-Key",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
