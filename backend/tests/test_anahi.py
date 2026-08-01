import json

import pytest

from config import Settings
from routers import anahi as anahi_router
from services import anahi as anahi_service
from time_utils import app_today


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size: int = -1) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def anahi_settings() -> Settings:
    return Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN="test-ritmo-key",
        GEMINI_API_KEY="server-only-test-key",
        GEMINI_MODEL="gemini-3.5-flash-lite",
        GEMINI_TIMEOUT_SECONDS=12,
        CORS_ORIGINS="http://localhost:5173",
    )


def test_anahi_service_posts_server_side_request_and_extracts_text(monkeypatch):
    recorded: dict[str, object] = {}

    def fake_urlopen(request, timeout):
        recorded["request"] = request
        recorded["timeout"] = timeout
        return FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "Comece com uma tarefa de cinco minutos."}],
                        },
                    },
                ],
            },
        )

    monkeypatch.setattr(anahi_service, "urlopen", fake_urlopen)
    settings = anahi_settings()

    answer = anahi_service.generate_anahi_answer(
        "Como sair da procrastinacao?",
        settings,
        {
            "profile": {"name": "Antonio"},
            "reading": {
                "closest_to_finish": {
                    "title": "Livro de teste",
                    "progress_percent": 82.5,
                },
            },
        },
    )

    request = recorded["request"]
    assert answer == "Comece com uma tarefa de cinco minutos."
    assert recorded["timeout"] == 12
    assert request.full_url == (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-3.5-flash-lite:generateContent"
    )
    assert "server-only-test-key" not in request.full_url
    assert request.get_header("X-goog-api-key") == "server-only-test-key"
    body = json.loads(request.data.decode("utf-8"))
    parts = body["contents"][0]["parts"]
    assert "CONTEXTO_DO_PERFIL_JSON" in parts[0]["text"]
    assert '"name":"Antonio"' in parts[0]["text"]
    assert '"title":"Livro de teste"' in parts[0]["text"]
    assert parts[1] == {"text": "Como sair da procrastinacao?"}
    assert body["generationConfig"]["maxOutputTokens"] == 1_024
    assert body["generationConfig"]["thinkingConfig"] == {
        "thinkingLevel": "minimal",
    }


def test_anahi_service_handles_timeout_and_unusable_response_without_network(monkeypatch):
    settings = anahi_settings()

    def timed_out(*_args, **_kwargs):
        raise TimeoutError

    monkeypatch.setattr(anahi_service, "urlopen", timed_out)
    with pytest.raises(anahi_service.AnahiTimeoutError):
        anahi_service.generate_anahi_answer("Pergunta", settings)

    monkeypatch.setattr(anahi_service, "urlopen", lambda *_args, **_kwargs: FakeResponse({}))
    with pytest.raises(anahi_service.AnahiUnavailableError):
        anahi_service.generate_anahi_answer("Pergunta", settings)


def test_anahi_settings_keeps_api_key_secret_and_validates_model_name():
    settings = anahi_settings()
    assert settings.gemini_api_key == "server-only-test-key"
    assert "server-only-test-key" not in repr(settings)

    with pytest.raises(ValueError, match="GEMINI_MODEL contains invalid characters"):
        Settings(
            _env_file=None,
            DEBUG=True,
            GEMINI_MODEL="../unexpected",
            CORS_ORIGINS="http://localhost:5173",
        )


def test_anahi_route_is_protected_and_returns_safe_errors(
    client,
    auth_headers,
    user_id,
    monkeypatch,
):
    route = f"/api/users/{user_id}/anahi/ask"
    assert client.post(route, json={"question": "Oi"}).status_code == 401

    unconfigured = client.post(
        route,
        headers=auth_headers,
        json={"question": "Oi"},
    )
    assert unconfigured.status_code == 503
    assert unconfigured.json() == {
        "detail": "A assistente ANAHÍ ainda nao esta configurada.",
    }

    captured_context: dict = {}

    def fake_answer(question, _settings, profile_context):
        captured_context.update(profile_context)
        return f"ANAHÍ: {question} para {profile_context['profile']['name']}"

    monkeypatch.setattr(anahi_router, "generate_anahi_answer", fake_answer)
    answered = client.post(
        route,
        headers=auth_headers,
        json={"question": "Qual o proximo passo?"},
    )
    assert answered.status_code == 200
    assert answered.json() == {
        "answer": "ANAHÍ: Qual o proximo passo? para Antonio",
        "model": "gemini-3.5-flash-lite",
        "profile_name": "Antonio",
        "as_of": app_today().isoformat(),
        "used_sources": [],
    }
    assert set(captured_context) == {"profile", "reference_date"}

    monkeypatch.setattr(
        anahi_router,
        "generate_anahi_answer",
        lambda *_args: (_ for _ in ()).throw(anahi_service.AnahiTimeoutError()),
    )
    timed_out = client.post(
        route,
        headers=auth_headers,
        json={"question": "Tente de novo"},
    )
    assert timed_out.status_code == 504
    assert timed_out.json() == {
        "detail": "A assistente ANAHÍ demorou para responder. Tente novamente.",
    }


def test_anahi_route_rejects_an_overlong_question(
    client,
    auth_headers,
    user_id,
    monkeypatch,
):
    monkeypatch.setattr(
        anahi_router,
        "generate_anahi_answer",
        lambda *_args: pytest.fail("The provider must not be called for invalid input"),
    )

    response = client.post(
        f"/api/users/{user_id}/anahi/ask",
        headers=auth_headers,
        json={"question": "a" * 1_001},
    )
    assert response.status_code == 422


def test_anahi_route_rejects_unknown_profile_before_calling_provider(
    client,
    auth_headers,
    monkeypatch,
):
    monkeypatch.setattr(
        anahi_router,
        "generate_anahi_answer",
        lambda *_args: pytest.fail("Provider must not receive another profile"),
    )

    response = client.post(
        "/api/users/999999/anahi/ask",
        headers=auth_headers,
        json={"question": "Qual livro estou lendo?"},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Perfil nao encontrado."}
