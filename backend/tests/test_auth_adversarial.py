"""Adversarial tests for the browser authentication layer.

Each test reproduces a concrete attack or failure mode and asserts on the
observable result (HTTP status, database state, or CLI output), not on internal
function calls.
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models.habit import Habit
from models.reading import ReadingBook
from models.session import UserSession
from models.shopping import ShoppingPair
from models.user import User
from models.workout import Workout, WorkoutSession
from rate_limit import limiter
from security import hash_password, login_failure_limiter, revoke_all_sessions

PASSWORD = "senha-ficticia-de-teste"
BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_failure_limiter.reset()
    limiter._limiter.storage.reset()
    yield
    login_failure_limiter.reset()
    limiter._limiter.storage.reset()


@pytest.fixture()
def profiles(context):
    db = context.session_factory()
    try:
        users = db.query(User).order_by(User.id).all()
        for user in users:
            user.password_hash = hash_password(PASSWORD)
        db.commit()
        return {user.profile_id: user.id for user in users}
    finally:
        db.close()


def login(client, profile_id: str = "antonio", password: str = PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"profile_id": profile_id, "password": password},
    )


def csrf(client) -> str:
    return client.cookies.get("ritmo_csrf") or ""


# ---------------------------------------------------------------------------
# Enumeration
# ---------------------------------------------------------------------------


def test_users_endpoint_hides_other_profiles_from_session(client, profiles, auth_headers):
    assert login(client).status_code == 200

    session_view = client.get("/api/users").json()
    assert [user["profile_id"] for user in session_view] == ["antonio"]

    client.cookies.clear()
    server_view = client.get("/api/users", headers=auth_headers).json()
    assert {user["profile_id"] for user in server_view} == {"antonio", "itayna"}


def test_profile_directory_is_minimal(client):
    response = client.get("/api/auth/profiles")

    assert response.status_code == 200
    assert all(set(entry) == {"profile_id", "name"} for entry in response.json())


# ---------------------------------------------------------------------------
# CSRF
# ---------------------------------------------------------------------------


def test_csrf_from_another_session_is_rejected(client, profiles, context):
    assert login(client, "antonio").status_code == 200
    other_csrf = csrf(client)
    user_id = profiles["antonio"]

    # Fresh login rotates the token: the previous session's token must not work.
    assert login(client, "antonio").status_code == 200
    response = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers={"X-CSRF-Token": other_csrf},
    )

    assert response.status_code == 403
    db = context.session_factory()
    try:
        assert db.query(Habit).count() == 0
    finally:
        db.close()


def test_forged_csrf_cookie_does_not_authorize(client, profiles, context):
    assert login(client).status_code == 200
    user_id = profiles["antonio"]

    # An attacker who can set a cookie (subdomain, MITM on http) still cannot
    # guess the value bound to the server-side session.
    client.cookies.set("ritmo_csrf", "valor-forjado")
    response = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers={"X-CSRF-Token": "valor-forjado"},
    )

    assert response.status_code == 403
    db = context.session_factory()
    try:
        assert db.query(Habit).count() == 0
    finally:
        db.close()


def test_cross_site_fetch_metadata_is_rejected(client, profiles, context):
    assert login(client).status_code == 200
    user_id = profiles["antonio"]

    response = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers={
            "X-CSRF-Token": csrf(client),
            "Sec-Fetch-Site": "cross-site",
        },
    )

    assert response.status_code == 403
    db = context.session_factory()
    try:
        assert db.query(Habit).count() == 0
    finally:
        db.close()


@pytest.mark.parametrize(
    "origin",
    [
        "null",
        "https://atacante.example",
        "https://habitos-base.vercel.app.atacante.example",
        "https://habitos-base.vercel.app/extra",
        "http://habitos-base.vercel.app",
    ],
)
def test_foreign_or_malformed_origin_is_rejected(client, profiles, origin):
    assert login(client).status_code == 200
    user_id = profiles["antonio"]

    response = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers={"X-CSRF-Token": csrf(client), "Origin": origin},
    )

    assert response.status_code == 403


def test_missing_origin_still_requires_csrf(client, profiles):
    assert login(client).status_code == 200
    user_id = profiles["antonio"]

    without_token = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
    )
    assert without_token.status_code == 403

    with_token = client.post(
        f"/api/users/{user_id}/habits",
        json={"name": "Ler", "time": "08:00"},
        headers={"X-CSRF-Token": csrf(client)},
    )
    assert with_token.status_code == 200


def test_read_requests_do_not_require_csrf(client, profiles):
    assert login(client).status_code == 200
    user_id = profiles["antonio"]

    assert client.get(f"/api/users/{user_id}/habits").status_code == 200


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def test_revoked_token_cannot_be_reused(client, profiles, context):
    assert login(client).status_code == 200
    stolen = client.cookies.get("ritmo_session")
    token = csrf(client)

    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": token}).status_code == 200

    # Replaying the old cookie after logout must fail.
    client.cookies.set("ritmo_session", stolen)
    client.cookies.set("ritmo_csrf", token)
    response = client.get("/api/users")

    assert response.status_code == 401

    db = context.session_factory()
    try:
        assert db.query(UserSession).filter(UserSession.revoked_at.isnot(None)).count() == 1
    finally:
        db.close()


def test_expired_session_is_rejected_server_side(client, profiles, context):
    assert login(client).status_code == 200
    token = csrf(client)

    db = context.session_factory()
    try:
        row = db.query(UserSession).one()
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    finally:
        db.close()

    client.cookies.set("ritmo_csrf", token)
    assert client.get("/api/users").status_code == 401


def test_session_cannot_escalate_with_an_api_key_header(client, profiles, auth_headers):
    assert login(client).status_code == 200
    user_id = profiles["antonio"]
    other_id = profiles["itayna"]

    # Sending the API key while holding a session must not widen the scope.
    response = client.get(f"/api/users/{other_id}/habits", headers=auth_headers)

    assert response.status_code == 403
    assert client.get(f"/api/users/{user_id}/habits").status_code == 200


def test_password_rotation_revokes_existing_sessions(profiles, context):
    db = context.session_factory()
    try:
        user = db.query(User).filter(User.id == profiles["antonio"]).one()
        db.add(
            UserSession(
                user_id=user.id,
                token_hash="a" * 64,
                csrf_hash="b" * 64,
                created_at=datetime.now(UTC),
                last_seen_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()

        revoke_all_sessions(db, user.id)

        rows = db.query(UserSession).filter(UserSession.user_id == user.id).all()
        assert rows and all(row.revoked_at is not None for row in rows)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# IDOR
# ---------------------------------------------------------------------------


def test_idor_on_habits_tasks_and_shopping(client, profiles, context, auth_headers):
    other_id = profiles["itayna"]
    created = client.post(
        f"/api/users/{other_id}/habits",
        json={"name": "Hábito da Itayna", "time": "07:00"},
        headers=auth_headers,
    ).json()

    assert login(client, "antonio").status_code == 200
    token = csrf(client)

    assert client.put(
        f"/api/habits/{created['id']}",
        json={"name": "sequestrado"},
        headers={"X-CSRF-Token": token},
    ).status_code == 403
    assert client.delete(
        f"/api/habits/{created['id']}",
        headers={"X-CSRF-Token": token},
    ).status_code == 403

    client.cookies.clear()
    still_there = client.get(
        f"/api/users/{other_id}/habits",
        headers=auth_headers,
    ).json()
    assert [habit["name"] for habit in still_there] == ["Hábito da Itayna"]


def test_idor_on_reading_workouts_and_shopping(client, profiles, context, auth_headers):
    other_id = profiles["itayna"]

    db = context.session_factory()
    try:
        book = ReadingBook(
            user_id=other_id,
            title="Livro da Itayna",
            current_page=0,
            total_pages=10,
            notes="",
            status="lendo",
            is_active=True,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        workout = Workout(user_id=other_id, day="Seg", title="Treino da Itayna")
        db.add_all([book, workout])
        db.flush()
        session_row = WorkoutSession(
            user_id=other_id,
            workout_id=workout.id,
            workout_title=workout.title,
            workout_day="Seg",
            status="completed",
            rest_seconds=60,
            started_at=datetime.now(UTC),
            revision=0,
        )
        db.add(session_row)
        db.commit()
        book_id = book.id
        session_id = session_row.id
    finally:
        db.close()

    assert login(client, "antonio").status_code == 200
    token = csrf(client)
    headers = {"X-CSRF-Token": token}

    assert client.delete(f"/api/reading-books/{book_id}", headers=headers).status_code == 403
    assert client.delete(f"/api/workout-sessions/{session_id}", headers=headers).status_code == 403
    assert client.get(f"/api/workout-sessions/{session_id}").status_code == 403


def test_shopping_pair_allows_partner_but_not_strangers(client, profiles, context):
    antonio_id = profiles["antonio"]
    itayna_id = profiles["itayna"]

    db = context.session_factory()
    try:
        db.add(
            ShoppingPair(
                owner_user_id=antonio_id,
                partner_user_id=itayna_id,
                invite_code="PAIRTEST001",
                created_at=datetime.now(UTC),
                paired_at=datetime.now(UTC),
            )
        )
        list_row = __import__("models.shopping", fromlist=["ShoppingList"]).ShoppingList(
            user_id=itayna_id,
            name="Compra da casa",
            kind="monthly",
            category="groceries",
            planned_date=datetime.now(UTC).date(),
            total_cents=0,
            revision=0,
            created_at=datetime.now(UTC),
        )
        db.add(list_row)
        db.commit()
        list_id = list_row.id
    finally:
        db.close()

    # Antonio is paired with Itayna, so the shared list is reachable by id.
    assert login(client, "antonio").status_code == 200
    assert client.get(f"/api/shopping-lists/{list_id}").status_code == 200

    # The path-scoped profile surface still refuses the partner's user id.
    assert client.get(f"/api/users/{itayna_id}/shopping-lists").status_code == 403


def test_unpaired_profile_cannot_reach_another_profiles_shopping(
    client,
    profiles,
    context,
):
    other_id = profiles["itayna"]

    db = context.session_factory()
    try:
        list_row = __import__("models.shopping", fromlist=["ShoppingList"]).ShoppingList(
            user_id=other_id,
            name="Compra privada",
            kind="monthly",
            category="groceries",
            planned_date=datetime.now(UTC).date(),
            total_cents=0,
            revision=0,
            created_at=datetime.now(UTC),
        )
        db.add(list_row)
        db.commit()
        list_id = list_row.id
    finally:
        db.close()

    assert login(client, "antonio").status_code == 200
    assert client.get(f"/api/shopping-lists/{list_id}").status_code == 403


def test_non_numeric_profile_id_is_forbidden_not_a_server_error(client, profiles):
    assert login(client).status_code == 200

    response = client.get("/api/users/nao-e-numero/habits")

    assert response.status_code in {403, 404, 422}
    assert response.status_code < 500


# ---------------------------------------------------------------------------
# Error surface
# ---------------------------------------------------------------------------


def test_production_requires_an_explicit_database_url():
    """A published environment must never fall back to local SQLite.

    This is the failure that broke the first staging deploy: an empty
    DATABASE_URL bound an ephemeral SQLite file and the app crashed later with
    "no such table: users" instead of refusing to start.
    """
    from config import Settings

    with pytest.raises(Exception, match="DATABASE_URL is required"):
        Settings(
            _env_file=None,
            DEBUG=False,
            APP_ACCESS_TOKEN="x" * 40,
            DATABASE_URL=None,
            CORS_ORIGINS="https://example.invalid",
        )

    with pytest.raises(Exception, match="DATABASE_URL is required"):
        Settings(
            _env_file=None,
            DEBUG=False,
            APP_ACCESS_TOKEN="x" * 40,
            DATABASE_URL="",
            CORS_ORIGINS="https://example.invalid",
        )


def test_development_still_allows_the_local_sqlite_default():
    from config import Settings

    settings = Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN=None,
        ALLOW_INSECURE_NO_ACCESS_TOKEN=True,
        DATABASE_URL=None,
        CORS_ORIGINS="http://localhost:5173",
    )

    assert settings.database_url == "sqlite:///./ritmo.db"


def test_login_errors_do_not_leak_internals(client, profiles):
    response = login(client, "antonio", "senha-errada")

    body = response.text.lower()
    assert "argon2" not in body
    assert "traceback" not in body
    assert "password_hash" not in body
    assert response.json()["detail"] == "Perfil ou senha invalidos"


def test_unauthenticated_request_does_not_leak_configuration(client):
    response = client.get("/api/users")

    body = response.text.lower()
    assert response.status_code == 401
    for needle in ("database_url", "app_access_token", "sqlite", "postgres"):
        assert needle not in body


# ---------------------------------------------------------------------------
# Password provisioning CLI
# ---------------------------------------------------------------------------


@pytest.fixture()
def disposable_database(tmp_path):
    path = tmp_path / "provisioning.db"
    url = f"sqlite:///{path.as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    try:
        db.add(User(profile_id="ficticio", name="Ficticio", initials="FC", theme="light"))
        db.add(User(profile_id="outro", name="Outro", initials="OU", theme="light"))
        db.commit()
    finally:
        db.close()
    yield url
    engine.dispose()


def _run_cli(url: str, *args: str, password: str = "senha-cli-longa-123", env_extra=None):
    env = {
        "PATH": os.environ.get("PATH", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        "PYTHONIOENCODING": "utf-8",
    }
    if url:
        env["DATABASE_URL"] = url
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, "-m", "scripts.set_profile_password", *args],
        cwd=BACKEND_DIR,
        env=env,
        input=password + "\n",
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_cli_requires_explicit_database_url():
    result = _run_cli("", "--profile-id", "ficticio", "--stdin")

    assert result.returncode != 0
    assert "DATABASE_URL is not set" in result.stderr
    assert "senha-cli" not in result.stdout + result.stderr


def test_cli_refuses_the_legacy_database():
    result = _run_cli("sqlite:///./ritmo.db", "--profile-id", "ficticio", "--stdin")

    assert result.returncode != 0
    assert "legacy SQLite" in result.stderr


def test_cli_sets_only_the_target_profile_and_revokes_sessions(disposable_database):
    url = disposable_database
    engine = create_engine(url)
    factory = sessionmaker(bind=engine)
    db = factory()
    try:
        target = db.query(User).filter(User.profile_id == "ficticio").one()
        other = db.query(User).filter(User.profile_id == "outro").one()
        db.add(
            UserSession(
                user_id=target.id,
                token_hash="c" * 64,
                csrf_hash="d" * 64,
                created_at=datetime.now(UTC),
                last_seen_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()
        target_id, other_id = target.id, other.id
    finally:
        db.close()

    result = _run_cli(url, "--profile-id", "ficticio", "--stdin")

    assert result.returncode == 0, result.stderr
    assert "senha-cli" not in result.stdout + result.stderr

    db = factory()
    try:
        target = db.get(User, target_id)
        other = db.get(User, other_id)
        assert target.password_hash and target.password_hash.startswith("$argon2id$")
        assert other.password_hash is None
        assert db.query(UserSession).filter(UserSession.user_id == target_id).one().revoked_at
    finally:
        db.close()


def test_cli_fails_for_unknown_profile(disposable_database):
    result = _run_cli(disposable_database, "--profile-id", "nao-existe", "--stdin")

    assert result.returncode != 0
    assert "profile not found" in result.stderr


def test_cli_rejects_a_short_password(disposable_database):
    result = _run_cli(
        disposable_database,
        "--profile-id",
        "ficticio",
        "--stdin",
        password="curta",
    )

    assert result.returncode != 0
    assert "12 characters" in result.stderr
