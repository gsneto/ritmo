"""Provision or rotate the password of one Ritmo profile.

This is an operator tool, not a public endpoint. It talks to the database
directly, so it must run inside the trusted environment (local machine or a
one-off shell in the hosting provider).

Safety rules:

* The password is read from a prompt or from stdin, never from a command-line
  argument, so it does not end up in shell history or process lists.
* ``DATABASE_URL`` must be set explicitly in the process environment. The tool
  refuses to fall back to the development default, because that default is the
  legacy SQLite database.
* The legacy ``ritmo.db`` file is refused unless ``--allow-legacy-db`` is
  passed, and even then only with a warning.
* Existing browser sessions for the profile are revoked, so a rotated password
  also logs out devices that already hold a cookie.

Usage:
    python -m scripts.set_profile_password --profile-id antonio
    Get-Content .\\password.txt | python -m scripts.set_profile_password ^
        --profile-id antonio --stdin
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

LEGACY_DB_NAMES = {"ritmo.db"}


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL", "").strip()
    if not value:
        raise SystemExit(
            "DATABASE_URL is not set. Set it explicitly to the target database; "
            "this tool never falls back to the development default."
        )
    return value


def _refuse_legacy_sqlite(url: str, allow_legacy: bool) -> None:
    if not url.startswith("sqlite"):
        return
    path = url.split("://", 1)[-1].lstrip("/")
    if Path(path).name not in LEGACY_DB_NAMES:
        return
    if not allow_legacy:
        raise SystemExit(
            "refusing to write to the legacy SQLite database (ritmo.db). "
            "Point DATABASE_URL at a disposable database, or pass "
            "--allow-legacy-db if you really mean it."
        )
    print(
        "warning: writing to the legacy SQLite database on purpose",
        file=sys.stderr,
    )


def _read_password(use_stdin: bool) -> str:
    if use_stdin:
        value = sys.stdin.readline().rstrip("\r\n")
        if not value:
            raise SystemExit("empty password on stdin")
        return value

    first = getpass.getpass("New password: ")
    second = getpass.getpass("Repeat password: ")
    if first != second:
        raise SystemExit("passwords do not match")
    return first


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Set or rotate the password of one Ritmo profile.",
    )
    parser.add_argument("--profile-id", required=True)
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="read the password from stdin instead of prompting",
    )
    parser.add_argument(
        "--allow-legacy-db",
        action="store_true",
        help="permit writing to ritmo.db (normally forbidden)",
    )
    args = parser.parse_args()

    url = _database_url()
    _refuse_legacy_sqlite(url, args.allow_legacy_db)

    # DATABASE_URL must be final before any project module is imported, because
    # database.py binds the engine at import time.
    os.environ["DATABASE_URL"] = url

    from sqlalchemy import select

    from database import SessionLocal

    # Importing every model lets SQLAlchemy resolve the User relationships.
    from models import habit, push, reading, shopping, task, workout  # noqa: F401
    from models import session as session_model  # noqa: F401
    from models.user import User
    from security import hash_password, revoke_all_sessions, validate_password_strength

    password = _read_password(args.stdin)
    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    session = SessionLocal()
    try:
        user = session.execute(
            select(User).where(User.profile_id == args.profile_id)
        ).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"profile not found: {args.profile_id}")
        user.password_hash = hash_password(password)
        session.commit()
        revoke_all_sessions(session, user.id)
    finally:
        session.close()

    print(f"password updated for profile: {args.profile_id}")
    print("existing browser sessions for this profile were revoked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
