import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from config import Settings
from database import get_db
from main import create_app
from security import auth_failure_limiter, validate_api_key


def test_api_requires_configured_key_but_public_routes_do_not(client, auth_headers):
    assert client.get("/").status_code == 200
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert health.json()["timezone"] == "America/Sao_Paulo"

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


def test_debug_can_run_without_a_key_but_production_cannot():
    development = Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN=None,
        CORS_ORIGINS="http://localhost:5173",
    )
    assert validate_api_key(None, development, "development-test") is None

    with pytest.raises(ValidationError, match="APP_ACCESS_TOKEN is required"):
        Settings(
            _env_file=None,
            DEBUG=False,
            APP_ACCESS_TOKEN=None,
            CORS_ORIGINS="https://ritmo.example",
        )

    production = Settings(
        _env_file=None,
        DEBUG=False,
        APP_ACCESS_TOKEN="production-secret",
        CORS_ORIGINS="https://ritmo.example",
    )
    production_app = create_app(production)
    assert production_app.docs_url is None
    assert production_app.redoc_url is None
    assert production_app.openapi_url is None

    with pytest.raises(HTTPException) as error:
        validate_api_key("incorrect", production, "production-test")
    assert error.value.status_code == 401


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
