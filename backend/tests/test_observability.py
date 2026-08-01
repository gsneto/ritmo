from config import Settings
from main import configure_sentry
import main as main_module


def test_sentry_is_disabled_without_a_dsn(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        SENTRY_DSN="  ",
        CORS_ORIGINS="http://localhost:5173",
    )

    configure_sentry(settings)

    assert calls == []


def test_sentry_uses_safe_fastapi_defaults(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    settings = Settings(
        _env_file=None,
        DEBUG=False,
        APP_ACCESS_TOKEN="production-secret",
        SENTRY_DSN="https://public@example.ingest.sentry.io/123",
        SENTRY_ENVIRONMENT="production",
        CORS_ORIGINS="https://ritmo.example",
    )

    configure_sentry(settings)

    assert len(calls) == 1
    assert calls[0]["dsn"] == "https://public@example.ingest.sentry.io/123"
    assert calls[0]["environment"] == "production"
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["traces_sample_rate"] == 0.0
    assert len(calls[0]["integrations"]) == 1
