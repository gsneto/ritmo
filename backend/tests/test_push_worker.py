import tomllib
from pathlib import Path
from threading import Event

import pytest

from config import Settings
from push_worker import PushWorkerState, notification_runtime, run_worker, validate_worker_settings


def worker_settings(**overrides):
    return Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        **overrides,
    )


def test_worker_requires_vapid_configuration():
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
    )

    with pytest.raises(RuntimeError, match="complete VAPID configuration"):
        validate_worker_settings(settings)


def test_scheduler_runs_in_api_by_default_and_external_mode_is_explicit():
    embedded = worker_settings()
    external = worker_settings(PUSH_SCHEDULER_IN_API=False)

    assert embedded.PUSH_SCHEDULER_IN_API is True
    assert notification_runtime(embedded, PushWorkerState())["mode"] == "embedded"
    assert notification_runtime(external, PushWorkerState()) == {
        "configured": True,
        "mode": "external",
        "status": "external",
        "last_cycle_at": None,
    }


def test_worker_updates_thread_safe_snapshot_and_runs_first_cycle_immediately(
    monkeypatch,
):
    stopped = Event()
    state = PushWorkerState()
    calls = 0

    received_stop_event = None

    def fake_cycle(_session_factory, _settings, *, stop_event):
        nonlocal calls
        nonlocal received_stop_event
        calls += 1
        received_stop_event = stop_event
        stopped.set()
        return {"enqueued": 2, "processed": 1}

    monkeypatch.setattr("push_scheduler.run_push_cycle", fake_cycle)

    assert run_worker(
        worker_settings(),
        stop_event=stopped,
        state=state,
        session_factory=lambda: None,
    ) == 0
    snapshot = state.snapshot()
    assert calls == 1
    assert received_stop_event is stopped
    assert snapshot["running"] is False
    assert snapshot["last_successful_cycle_at"] is not None
    assert snapshot["last_error"] is None
    assert snapshot["last_cycle_counts"] == {"enqueued": 2, "processed": 1}


def test_worker_error_snapshot_and_log_do_not_expose_exception_message(
    monkeypatch,
    caplog,
):
    state = PushWorkerState()

    def failed_cycle(_session_factory, _settings, *, stop_event):
        assert stop_event is not None
        raise RuntimeError("VAPID-private-secret")

    monkeypatch.setattr("push_scheduler.run_push_cycle", failed_cycle)

    assert run_worker(
        worker_settings(),
        once=True,
        state=state,
        session_factory=lambda: None,
    ) == 1
    snapshot = state.snapshot()
    assert snapshot["running"] is False
    assert snapshot["last_error"] == "RuntimeError"
    assert snapshot["last_error_at"] is not None
    assert "VAPID-private-secret" not in caplog.text


def test_railway_worker_has_dedicated_versioned_command():
    backend_dir = Path(__file__).parents[1]
    with (backend_dir / "railway.worker.toml").open("rb") as config_file:
        worker_config = tomllib.load(config_file)
    with (backend_dir / "railway.toml").open("rb") as config_file:
        api_config = tomllib.load(config_file)

    assert worker_config["deploy"]["startCommand"] == "python -m push_worker"
    assert worker_config["deploy"]["preDeployCommand"] == "alembic upgrade head"
    assert worker_config["deploy"]["restartPolicyType"] == "ALWAYS"
    assert api_config["deploy"]["startCommand"].startswith("uvicorn main:app")
    assert api_config["deploy"]["healthcheckPath"] == "/ready"
    assert "push_worker" not in api_config["deploy"]["startCommand"]


def test_standard_release_publishes_only_the_embedded_api_scheduler():
    workflow = (
        Path(__file__).parents[2] / ".github" / "workflows" / "deploy-backend.yml"
    ).read_text(encoding="utf-8")
    assert "RAILWAY_WORKER_SERVICE" not in workflow
    assert '--service "$RAILWAY_SERVICE"' in workflow
    assert '"$base_url/ready"' in workflow
    assert workflow.count("--ci") == 1
