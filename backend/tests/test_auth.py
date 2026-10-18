from datetime import UTC, datetime, timedelta

import pytest

from models.shopping import ShoppingPair
from models.user import User
from rate_limit import limiter
from security import (
    auth_failure_limiter,
    hash_password,
    login_failure_limiter,
    validate_password_strength,
)

PASSWORD = "senha-ficticia-de-teste"


@pytest.fixture(autouse=True)
def _reset_limiters():
    auth_failure_limiter.reset()
    login_failure_limiter.reset()
    limiter._limiter.storage.reset()
    yield
    auth_failure_limiter.reset()
    login_failure_limiter.reset()
    limiter._limiter.storage.reset()


@pytest.fixture()
def profiles(context):
    """Give both seeded profiles a password and return their ids."""
    db = context.session_factory()
    try:
        users = db.query(User).order_by(User.id).all()
        for user in users:
            user.password_hash = hash_password(PASSWORD)
        db.commit()
        return {user.profile_id: user.id for user in users}
    finally:
        db.close()


def login(client, profile_id: str, password: str = PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"profile_id": profile_id, "password": password},
    )


def csrf(client) -> str:
    return client.cookies.get("ritmo_csrf") or ""


def test_login_creates_an_httponly_session(client, profiles):
    response = login(client, "antonio")

    assert response.status_code == 200
    assert response.json()["profile"]["profile_id"] == "antonio"

    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert client.cookies.get("ritmo_csrf")

    session = client.get("/api/auth/session")
    assert session.status_code == 200
    assert session.json()["profile"]["profile_id"] == "antonio"


def test_login_rejects_wrong_password_and_unknown_profile_identically(
    client,
    profiles,
):
    wrong_password = login(client, "antonio", "senha-errada")
    unknown_profile = login(client, "nao-existe", PASSWORD)

    assert wrong_password.status_code == 401
    assert unknown_profile.status_code == 401
    assert wrong_password.json() == unknown_profile.json()
    assert "antonio" not in wrong_password.json()["detail"]


def test_profile_without_password_cannot_log_in(client, context):
    db = context.session_factory()
    try:
        user = db.query(User).filter(User.profile_id == "itayna").one()
        user.password_hash = None
        db.commit()
    finally:
        db.close()

    response = login(client, "itayna", PASSWORD)

    assert response.status_code == 401
    assert response.json()["detail"] == "Perfil ou senha invalidos"


def test_protected_route_requires_a_credential(client, profiles):
    assert client.get("/api/users").status_code == 401
    assert client.get("/api/users/1/habits").status_code == 401


def test_api_key_keeps_working_for_server_callers(client, auth_headers, profiles):
    response = client.get("/api/users", headers=auth_headers)

    assert response.status_code == 200
    assert len(response.json()) == 2


def test_logout_revokes_the_session(client, profiles):
    assert login(client, "antonio").status_code == 200
    token = csrf(client)

    assert client.get("/api/auth/session").status_code == 200

    logout = client.post("/api/auth/logout", headers={"X-CSRF-Token": token})
    assert logout.status_code == 200

    assert client.get("/api/auth/session").status_code == 401


def test_session_cannot_address_another_profile(client, profiles):
    assert login(client, "antonio").status_code == 200
    antonio_id = profiles["antonio"]
    itayna_id = profiles["itayna"]

    own = client.get(f"/api/users/{antonio_id}/habits")
    other = client.get(f"/api/users/{itayna_id}/habits")

    assert own.status_code == 200
    assert other.status_code == 403


def test_session_cannot_mutate_another_profiles_habit(
    client,
    profiles,
    auth_headers,
):
    itayna_id = profiles["itayna"]
    created = client.post(
        f"/api/users/{itayna_id}/habits",
        json={"name": "Hábito da Itayna", "time": "07:00"},
        headers=auth_headers,
    )
    assert created.status_code == 200
    habit_id = created.json()["id"]

    assert login(client, "antonio").status_code == 200
    token = csrf(client)

    forbidden = client.put(
        f"/api/habits/{habit_id}",
        json={"name": "alterado"},
        headers={"X-CSRF-Token": token},
    )
    assert forbidden.status_code == 403

    # The API key path is unchanged, so the row is still readable server-side.
    client.cookies.clear()
    unchanged = client.get(
        f"/api/users/{itayna_id}/habits",
        headers=auth_headers,
    ).json()
    assert [habit["name"] for habit in unchanged] == ["Hábito da Itayna"]


def test_mutating_request_requires_csrf(client, profiles):
    assert login(client, "antonio").status_code == 200
    user_id = profiles["antonio"]
    payload = {"name": "Ler", "time": "08:00"}

    missing = client.post(f"/api/users/{user_id}/habits", json=payload)
    wrong = client.post(
        f"/api/users/{user_id}/habits",
        json=payload,
        headers={"X-CSRF-Token": "errado"},
    )
    valid = client.post(
        f"/api/users/{user_id}/habits",
        json=payload,
        headers={"X-CSRF-Token": csrf(client)},
    )

    assert missing.status_code == 403
    assert wrong.status_code == 403
    assert valid.status_code == 200


def test_csrf_is_not_required_for_api_key_callers(client, auth_headers, profiles):
    user_id = profiles["antonio"]

    response = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers=auth_headers,
    )

    assert response.status_code == 200


def test_foreign_origin_is_rejected(client, profiles):
    assert login(client, "antonio").status_code == 200
    user_id = profiles["antonio"]

    response = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers={
            "X-CSRF-Token": csrf(client),
            "Origin": "https://atacante.example",
        },
    )

    assert response.status_code == 403


def test_expired_session_is_rejected(client, context, profiles):
    assert login(client, "antonio").status_code == 200

    db = context.session_factory()
    try:
        from models.session import UserSession

        row = db.query(UserSession).one()
        row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()

    response = client.get("/api/auth/session")

    assert response.status_code == 401
    assert response.json()["detail"] == "Session expired"


def test_repeated_failures_lock_the_client_out(client, profiles, settings):
    attempts = settings.AUTH_MAX_FAILURES

    responses = [login(client, "antonio", "errada") for _ in range(attempts)]

    assert all(response.status_code == 401 for response in responses[:-1])
    assert responses[-1].status_code == 429
    assert login(client, "antonio").status_code == 429


def test_login_rotates_the_session_token(client, profiles):
    assert login(client, "antonio").status_code == 200
    first = client.cookies.get("ritmo_session")

    assert login(client, "antonio").status_code == 200
    second = client.cookies.get("ritmo_session")

    assert first and second
    assert first != second


def test_shared_shopping_pair_keeps_household_access(
    client,
    context,
    profiles,
):
    antonio_id = profiles["antonio"]
    itayna_id = profiles["itayna"]

    db = context.session_factory()
    try:
        db.add(
            ShoppingPair(
                owner_user_id=antonio_id,
                partner_user_id=itayna_id,
                invite_code="TESTEPAIR01",
                created_at=datetime.now(UTC),
                paired_at=datetime.now(UTC),
            )
        )
        db.commit()
    finally:
        db.close()

    assert login(client, "antonio").status_code == 200

    # The partner's list is reachable through the household scope, not by
    # spoofing a user id in the path.
    partner_lists = client.get(f"/api/users/{itayna_id}/shopping-lists")
    assert partner_lists.status_code == 403

    assert login(client, "antonio").status_code == 200
    own_share = client.get(f"/api/users/{antonio_id}/shopping-share")
    assert own_share.status_code == 200


def test_password_strength_rules():
    with pytest.raises(ValueError):
        validate_password_strength("curta")
    validate_password_strength("uma-senha-bem-longa")


def test_profile_directory_exposes_only_display_fields(client):
    response = client.get("/api/auth/profiles")

    assert response.status_code == 200
    entry = response.json()[0]
    assert set(entry) == {"profile_id", "name"}


def test_password_hash_never_appears_in_responses(client, profiles, auth_headers):
    body = client.get("/api/users", headers=auth_headers).text

    assert "password" not in body
    assert PASSWORD not in body
