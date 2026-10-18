"""Dry run of the profile import path with fully synthetic data.

The importer for the real migration is the existing ``PUT /api/users/{id}/backup``
endpoint: it validates the whole document, writes inside one transaction and
rolls back on any error. These tests exercise that path end to end so the real
run can rely on measured behaviour instead of assumptions.

Every value below is invented. No fixture is derived from the local database or
from the exported snapshots.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from models.habit import Habit
from models.reading import ReadingBook
from models.shopping import ShoppingList, ShoppingMonthlyBudget
from models.task import Task
from models.user import User
from models.workout import (
    Workout,
    WorkoutExercisePreference,
    WorkoutSession,
    WorkoutSetLog,
)

IMPORTED_AT = "2026-01-15T12:00:00Z"


def _backup(profile: dict, **overrides) -> dict:
    document = {
        "version": 2,
        "app": "Ritmo",
        "exported_at": IMPORTED_AT,
        "profile": profile,
        "habits": [],
        "tasks": [],
        "shopping_lists": [],
        "shopping_budgets": [],
        "workouts": [],
        "workout_sessions": [],
        "workout_preferences": [],
        "reading_books": [],
    }
    document.update(overrides)
    return document


def _rich_backup() -> dict:
    return _backup(
        {"name": "Perfil Alfa", "initials": "AA", "theme": "light"},
        habits=[
            {
                "source_id": 101,
                "name": "Alongar",
                "time": "07:00",
                "active_days": [1, 3, 5],
                "created_at": "2026-01-02",
                "check_ins": ["2026-01-03", "2026-01-05"],
            },
            {
                "source_id": 102,
                "name": "Beber água",
                "time": "09:30",
                "active_days": [0, 1, 2, 3, 4, 5, 6],
                "created_at": "2026-01-02",
                "check_ins": [],
            },
        ],
        tasks=[
            {
                "source_id": 201,
                "name": "Revisar contas",
                "date": "2026-01-20",
                "time": "18:00",
                "completed_at": None,
                "recurrence": "monthly",
                "recurrence_interval": 1,
                "created_at": "2026-01-02",
            },
            {
                "source_id": 202,
                "name": "Revisar contas (próxima)",
                "date": "2026-02-20",
                "time": "18:00",
                "completed_at": None,
                "recurrence": "monthly",
                "recurrence_interval": 1,
                "recurrence_parent_source_id": 201,
                "created_at": "2026-01-02",
            },
        ],
        shopping_lists=[
            {
                "source_id": 301,
                "ownership": "profile",
                "name": "Compra do mês",
                "kind": "monthly",
                "category": "groceries",
                "planned_date": "2026-01-10",
                "budget_cents": 40000,
                "repeat_enabled": False,
                "total_cents": 2500,
                "revision": 1,
                "created_at": IMPORTED_AT,
                "items": [
                    {
                        "source_id": 401,
                        "name": "Item A",
                        "quantity": 2,
                        "checked_at": IMPORTED_AT,
                        "unit_price_cents": 1250,
                        "price_cents": 2500,
                        "created_at": IMPORTED_AT,
                    },
                    {
                        "source_id": 402,
                        "name": "Item B",
                        "quantity": 1,
                        "created_at": IMPORTED_AT,
                    },
                ],
            },
            {
                "source_id": 302,
                "ownership": "shared",
                "name": "Compra compartilhada",
                "kind": "weekly",
                "category": "home",
                "planned_date": "2026-01-11",
                "total_cents": 0,
                "created_at": IMPORTED_AT,
                "items": [],
            },
        ],
        shopping_budgets=[
            {
                "month": "2026-01",
                "budget_cents": 50000,
                "created_at": IMPORTED_AT,
                "updated_at": IMPORTED_AT,
            }
        ],
        workouts=[
            {
                "source_id": 501,
                "day": "Seg",
                "title": "Treino sintético",
                "note": "Fixture de ensaio",
                "exercises": [
                    {"source_id": 601, "name": "Exercício A", "sets": "3", "reps": "10"},
                    {"source_id": 602, "name": "Exercício B", "sets": "2", "reps": "12"},
                ],
            }
        ],
        workout_sessions=[
            {
                "source_id": 701,
                "source_workout_id": 501,
                "workout_title": "Treino sintético",
                "workout_day": "Seg",
                "status": "completed",
                "rest_seconds": 60,
                "started_at": "2026-01-12T10:00:00Z",
                "completed_at": "2026-01-12T10:40:00Z",
                "duration_seconds": 2400,
                "revision": 1,
                "exercises": [
                    {
                        "source_exercise_id": 601,
                        "name": "Exercício A",
                        "target_sets": 3,
                        "planned_reps": "10",
                        "sort_order": 0,
                        "sets": [
                            {
                                "set_number": 1,
                                "weight_kg": 10.0,
                                "reps_completed": 10,
                                "completed_at": "2026-01-12T10:10:00Z",
                            },
                            {
                                "set_number": 2,
                                "weight_kg": 12.5,
                                "reps_completed": 8,
                                "completed_at": "2026-01-12T10:20:00Z",
                            },
                        ],
                    }
                ],
            }
        ],
        workout_preferences=[
            {
                "exercise_key": "exercicio-a",
                "display_name": "Exercício A",
                "rest_seconds": 45,
                "increment_kg": 2.5,
            }
        ],
        reading_books=[
            {
                "source_id": 801,
                "title": "Livro sintético",
                "current_page": 30,
                "total_pages": 200,
                "notes": "",
                "status": "lendo",
                "is_active": True,
                "created_at": IMPORTED_AT,
                "updated_at": IMPORTED_AT,
                "sessions": [
                    {
                        "session_date": "2026-01-14",
                        "start_page": 10,
                        "end_page": 30,
                        "duration_minutes": 25,
                        "source": "manual",
                        "created_at": IMPORTED_AT,
                    }
                ],
                "reading_notes": [
                    {
                        "note_date": "2026-01-14",
                        "page": 20,
                        "content": "Anotação sintética",
                        "created_at": IMPORTED_AT,
                        "updated_at": IMPORTED_AT,
                    }
                ],
            }
        ],
    )


def _small_backup() -> dict:
    return _backup(
        {"name": "Perfil Beta", "initials": "BB", "theme": "dark"},
        habits=[
            {
                "source_id": 901,
                "name": "Caminhar",
                "time": "06:30",
                "active_days": [2, 4],
                "created_at": "2026-01-04",
                "check_ins": [],
            }
        ],
        workouts=[
            {
                "source_id": 951,
                "day": "Ter",
                "title": "Treino beta",
                "note": None,
                "exercises": [
                    {"source_id": 961, "name": "Exercício C", "sets": None, "reps": None}
                ],
            }
        ],
    )


def _restore(client, auth_headers, user_id: int, document: dict):
    return client.put(
        f"/api/users/{user_id}/backup",
        json=document,
        headers=auth_headers,
    )


def _counts(db, user_id: int) -> dict[str, int]:
    return {
        "habits": db.query(Habit).filter(Habit.user_id == user_id).count(),
        "tasks": db.query(Task).filter(Task.user_id == user_id).count(),
        "shopping_lists": db.query(ShoppingList)
        .filter(ShoppingList.user_id == user_id)
        .count(),
        "budgets": db.query(ShoppingMonthlyBudget)
        .filter(ShoppingMonthlyBudget.user_id == user_id)
        .count(),
        "workouts": db.query(Workout).filter(Workout.user_id == user_id).count(),
        "sessions": db.query(WorkoutSession)
        .filter(WorkoutSession.user_id == user_id)
        .count(),
        "preferences": db.query(WorkoutExercisePreference)
        .filter(WorkoutExercisePreference.user_id == user_id)
        .count(),
        "books": db.query(ReadingBook).filter(ReadingBook.user_id == user_id).count(),
    }


def test_import_writes_the_full_profile_graph(client, context, auth_headers):
    db = context.session_factory()
    try:
        users = db.query(User).order_by(User.id).all()
        first, second = users[0], users[1]
    finally:
        db.close()

    response = _restore(client, auth_headers, first.id, _rich_backup())
    assert response.status_code == 200, response.text

    db = context.session_factory()
    try:
        counts = _counts(db, first.id)
        # The shared list is household-owned and deliberately not re-imported.
        assert counts == {
            "habits": 2,
            "tasks": 2,
            "shopping_lists": 1,
            "budgets": 1,
            "workouts": 1,
            "sessions": 1,
            "preferences": 1,
            "books": 1,
        }

        # Nested rows exist and point at their parents.
        habit = db.query(Habit).filter(Habit.user_id == first.id).first()
        assert habit is not None
        task = (
            db.query(Task)
            .filter(Task.user_id == first.id, Task.recurrence_parent_id.isnot(None))
            .one()
        )
        assert task.recurrence_parent_id is not None

        session = (
            db.query(WorkoutSession).filter(WorkoutSession.user_id == first.id).one()
        )
        assert session.status == "completed"
        assert (
            db.query(WorkoutSetLog)
            .filter(
                WorkoutSetLog.session_exercise_id.in_(
                    [item.id for item in session.exercises]
                )
            )
            .count()
            == 2
        )

        book = db.query(ReadingBook).filter(ReadingBook.user_id == first.id).one()
        assert book.is_active is True
        assert len(book.sessions) == 1
        assert len(book.reading_notes) == 1
    finally:
        db.close()

    # The second profile is untouched by the first import.
    assert _restore(client, auth_headers, second.id, _small_backup()).status_code == 200

    db = context.session_factory()
    try:
        first_counts = _counts(db, first.id)
        second_counts = _counts(db, second.id)
    finally:
        db.close()

    assert second_counts["habits"] == 1
    assert second_counts["workouts"] == 1
    assert second_counts["tasks"] == 0
    assert first_counts["habits"] == 2
    assert first_counts["workouts"] == 1


def test_import_is_idempotent(client, context, auth_headers):
    db = context.session_factory()
    try:
        user_id = db.query(User).order_by(User.id).first().id
    finally:
        db.close()

    document = _rich_backup()
    assert _restore(client, auth_headers, user_id, document).status_code == 200

    db = context.session_factory()
    try:
        first = _counts(db, user_id)
    finally:
        db.close()

    # Importing the same document again must not duplicate anything.
    assert _restore(client, auth_headers, user_id, document).status_code == 200

    db = context.session_factory()
    try:
        second = _counts(db, user_id)
    finally:
        db.close()

    assert first == second


def test_import_rejects_an_orphan_reference(client, context, auth_headers):
    db = context.session_factory()
    try:
        user_id = db.query(User).order_by(User.id).first().id
        before = _counts(db, user_id)
    finally:
        db.close()

    document = _rich_backup()
    document["workout_sessions"][0]["source_workout_id"] = 999_999

    response = _restore(client, auth_headers, user_id, document)

    assert response.status_code == 422
    db = context.session_factory()
    try:
        assert _counts(db, user_id) == before
    finally:
        db.close()


def test_import_rejects_duplicate_source_ids(client, context, auth_headers):
    db = context.session_factory()
    try:
        user_id = db.query(User).order_by(User.id).first().id
    finally:
        db.close()

    document = _rich_backup()
    document["habits"][1]["source_id"] = document["habits"][0]["source_id"]

    assert _restore(client, auth_headers, user_id, document).status_code == 422


def test_failed_commit_leaves_the_previous_state_intact(
    client,
    context,
    auth_headers,
):
    """A failure after the deletes must roll back, not leave a half-profile."""
    db = context.session_factory()
    try:
        user_id = db.query(User).order_by(User.id).first().id
    finally:
        db.close()

    assert _restore(client, auth_headers, user_id, _rich_backup()).status_code == 200

    db = context.session_factory()
    try:
        before = _counts(db, user_id)
    finally:
        db.close()

    original_commit = type(context.session_factory()).commit

    def explode(self):  # noqa: ANN001 - signature mirrors Session.commit
        raise RuntimeError("simulated failure during commit")

    # TestClient re-raises server errors by default, which is what we want here:
    # the failure must surface, and the database must still hold the old state.
    with patch.object(type(context.session_factory()), "commit", explode):
        with pytest.raises(RuntimeError, match="simulated failure"):
            _restore(client, auth_headers, user_id, _small_backup())

    assert original_commit is not explode

    db = context.session_factory()
    try:
        # The rollback must have preserved the rich profile, not the small one
        # and not an empty profile.
        assert _counts(db, user_id) == before
    finally:
        db.close()


def test_import_does_not_touch_the_other_profile(client, context, auth_headers):
    db = context.session_factory()
    try:
        users = db.query(User).order_by(User.id).all()
        first, second = users[0], users[1]
    finally:
        db.close()

    assert _restore(client, auth_headers, second.id, _small_backup()).status_code == 200

    db = context.session_factory()
    try:
        second_before = _counts(db, second.id)
    finally:
        db.close()

    assert _restore(client, auth_headers, first.id, _rich_backup()).status_code == 200

    db = context.session_factory()
    try:
        assert _counts(db, second.id) == second_before
    finally:
        db.close()


def test_import_never_creates_a_credential(client, context, auth_headers):
    db = context.session_factory()
    try:
        user = db.query(User).order_by(User.id).first()
        user_id = user.id
        user.password_hash = None
        db.commit()
    finally:
        db.close()

    assert _restore(client, auth_headers, user_id, _rich_backup()).status_code == 200

    db = context.session_factory()
    try:
        user = db.get(User, user_id)
        assert user is not None
        assert user.password_hash is None
        assert user.name == "Perfil Alfa"
        assert user.theme == "light"
    finally:
        db.close()


def test_imported_timestamps_keep_their_instant(client, context, auth_headers):
    db = context.session_factory()
    try:
        user_id = db.query(User).order_by(User.id).first().id
    finally:
        db.close()

    assert _restore(client, auth_headers, user_id, _rich_backup()).status_code == 200

    db = context.session_factory()
    try:
        session = (
            db.query(WorkoutSession).filter(WorkoutSession.user_id == user_id).one()
        )
        started = session.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=UTC)
        assert started == datetime(2026, 1, 12, 10, 0, tzinfo=UTC)
    finally:
        db.close()
