"""Startup seeding policy.

Demo fixtures (two profiles plus their workouts) used to be created on every
startup, including in a published environment. That produced passwordless
profiles nobody asked for. These tests pin the new contract: seeding is opt-in
and idempotent.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from config import Settings
from database import Base, create_database_engine, get_db, init_db
from main import create_app
from models.user import User
from models.workout import Exercise, Workout
from seed import DEFAULT_USERS, DEFAULT_WORKOUTS, seed_default_data


def _settings(tmp_path, *, seed: bool, debug: bool = True, database_url: str | None = None):
    return Settings(
        _env_file=None,
        DEBUG=debug,
        APP_ACCESS_TOKEN="seed-policy-token",
        DATABASE_URL=database_url
        or f"sqlite:///{(tmp_path / 'seed-policy.db').as_posix()}",
        CORS_ORIGINS="http://localhost:5173",
        SESSION_COOKIE_SECURE=False,
        SEED_DEFAULT_DATA=seed,
    )


def _build_app(settings):
    engine = create_database_engine(settings.database_url)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    application = create_app(
        settings,
        database_initializer=lambda: init_db(bind=engine, session_factory=factory),
        session_factory=factory,
    )
    application.dependency_overrides[get_db] = override_get_db
    return application, engine, factory


def test_published_environment_does_not_seed(tmp_path):
    settings = _settings(tmp_path, seed=False, debug=False)
    application, engine, factory = _build_app(settings)
    # A published environment never bootstraps DDL; create the schema so the
    # assertions below observe an empty, migrated database.
    Base.metadata.create_all(bind=engine)

    try:
        with TestClient(application):
            pass

        db = factory()
        try:
            assert db.query(User).count() == 0
            assert db.query(Workout).count() == 0
        finally:
            db.close()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_development_does_not_seed_by_default(tmp_path):
    # DEBUG=true alone must not create fixtures; the flag is what decides.
    settings = _settings(tmp_path, seed=False, debug=True)
    application, engine, factory = _build_app(settings)

    try:
        with TestClient(application):
            pass

        db = factory()
        try:
            assert db.query(User).count() == 0
        finally:
            db.close()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_explicit_flag_creates_the_demo_fixtures(tmp_path):
    settings = _settings(tmp_path, seed=True)
    application, engine, factory = _build_app(settings)

    try:
        with TestClient(application):
            pass

        db = factory()
        try:
            profiles = {user.profile_id for user in db.query(User).all()}
            assert profiles == {entry["profile_id"] for entry in DEFAULT_USERS}
            assert db.query(Workout).count() == len(DEFAULT_USERS) * len(DEFAULT_WORKOUTS)
            expected_exercises = sum(
                len(workout["exercises"]) for workout in DEFAULT_WORKOUTS
            ) * len(DEFAULT_USERS)
            assert db.query(Exercise).count() == expected_exercises
            # Fixtures must never carry a credential.
            assert all(user.password_hash is None for user in db.query(User).all())
        finally:
            db.close()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_seed_is_idempotent(tmp_path):
    settings = _settings(tmp_path, seed=True)
    application, engine, factory = _build_app(settings)

    try:
        with TestClient(application):
            pass

        db = factory()
        try:
            first_users = db.query(User).count()
            first_workouts = db.query(Workout).count()

            seed_default_data(db)
            seed_default_data(db)

            assert db.query(User).count() == first_users
            assert db.query(Workout).count() == first_workouts
        finally:
            db.close()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_seed_does_not_overwrite_existing_profiles(tmp_path):
    settings = _settings(tmp_path, seed=True)
    application, engine, factory = _build_app(settings)

    try:
        with TestClient(application):
            pass

        db = factory()
        try:
            user = db.query(User).filter(User.profile_id == "antonio").one()
            user.name = "Nome preservado"
            user.password_hash = "hash-preservado"
            db.commit()

            seed_default_data(db)

            db.refresh(user)
            assert user.name == "Nome preservado"
            assert user.password_hash == "hash-preservado"
        finally:
            db.close()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_seed_flag_defaults_to_false():
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        APP_ACCESS_TOKEN="x" * 40,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
    )

    assert settings.SEED_DEFAULT_DATA is False


def test_startup_without_seed_never_opens_a_session(tmp_path):
    settings = _settings(tmp_path, seed=False, debug=False)
    engine = create_database_engine(settings.database_url)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    application = create_app(
        settings,
        database_initializer=lambda: init_db(bind=engine, session_factory=factory),
        session_factory=factory,
    )

    try:
        with patch("main.seed_default_data") as seed_mock:
            with TestClient(application):
                pass
        seed_mock.assert_not_called()
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_production_without_database_url_still_fails_fast():
    with pytest.raises(Exception, match="DATABASE_URL is required"):
        Settings(
            _env_file=None,
            DEBUG=False,
            APP_ACCESS_TOKEN="x" * 40,
            DATABASE_URL=None,
            CORS_ORIGINS="https://example.invalid",
        )
