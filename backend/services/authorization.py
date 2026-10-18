"""Resource-level authorization for browser sessions.

The ``/api/users/{user_id}/...`` surface is guarded by ``enforce_profile_scope``
in ``security``. This module covers the remaining routes, where the profile is
implied by a resource id in the path.

Each resolver returns the profile ids that may access the resource, or ``None``
when the resource does not exist. A missing resource is not treated as an
authorization failure: the route itself answers 404, so we do not leak which
ids exist.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import cast

from sqlalchemy.orm import Session

from models.habit import Habit
from models.reading import ReadingBook, ReadingNote, ReadingSession
from models.shopping import ShoppingItem, ShoppingList
from models.task import Task
from models.workout import WorkoutSession, WorkoutSetLog
from services.shopping_scope import shopping_household_user_ids

Resolver = Callable[[Session, int], "set[int] | None"]


def _habit(db: Session, resource_id: int) -> set[int] | None:
    habit = db.get(Habit, resource_id)
    return {cast(int, habit.user_id)} if habit is not None else None


def _task(db: Session, resource_id: int) -> set[int] | None:
    task = db.get(Task, resource_id)
    return {cast(int, task.user_id)} if task is not None else None


def _reading_book(db: Session, resource_id: int) -> set[int] | None:
    book = db.get(ReadingBook, resource_id)
    return {cast(int, book.user_id)} if book is not None else None


def _reading_session(db: Session, resource_id: int) -> set[int] | None:
    reading_session = db.get(ReadingSession, resource_id)
    if reading_session is None:
        return None
    return _reading_book(db, cast(int, reading_session.book_id))


def _reading_note(db: Session, resource_id: int) -> set[int] | None:
    note = db.get(ReadingNote, resource_id)
    if note is None:
        return None
    return _reading_book(db, cast(int, note.book_id))


def _shopping_list(db: Session, resource_id: int) -> set[int] | None:
    shopping_list = db.get(ShoppingList, resource_id)
    if shopping_list is None:
        return None
    return set(shopping_household_user_ids(db, cast(int, shopping_list.user_id)))


def _shopping_item(db: Session, resource_id: int) -> set[int] | None:
    item = db.get(ShoppingItem, resource_id)
    if item is None:
        return None
    return _shopping_list(db, cast(int, item.shopping_list_id))


def _workout_session(db: Session, resource_id: int) -> set[int] | None:
    workout_session = db.get(WorkoutSession, resource_id)
    return {cast(int, workout_session.user_id)} if workout_session is not None else None


def _workout_set_log(db: Session, resource_id: int) -> set[int] | None:
    set_log = db.get(WorkoutSetLog, resource_id)
    if set_log is None:
        return None
    session_exercise = set_log.session_exercise
    if session_exercise is None:
        return None
    return _workout_session(db, cast(int, session_exercise.session_id))


# Ordered: the first matching pattern wins. ``reading-sessions`` must be tested
# before the generic workout ``workout-sessions`` entry, and both are distinct
# prefixes so the order only matters for clarity.
RESOURCE_PATTERNS: tuple[tuple[re.Pattern[str], str, Resolver], ...] = (
    (re.compile(r"^/api/habits/(?P<rid>\d+)(?:/|$)"), "rid", _habit),
    (re.compile(r"^/api/tasks/(?P<rid>\d+)(?:/|$)"), "rid", _task),
    (re.compile(r"^/api/reading-books/(?P<rid>\d+)(?:/|$)"), "rid", _reading_book),
    (re.compile(r"^/api/reading-sessions/(?P<rid>\d+)(?:/|$)"), "rid", _reading_session),
    (re.compile(r"^/api/reading-notes/(?P<rid>\d+)(?:/|$)"), "rid", _reading_note),
    (re.compile(r"^/api/shopping-lists/(?P<rid>\d+)(?:/|$)"), "rid", _shopping_list),
    (re.compile(r"^/api/shopping-items/(?P<rid>\d+)(?:/|$)"), "rid", _shopping_item),
    (re.compile(r"^/api/workout-sessions/(?P<rid>\d+)(?:/|$)"), "rid", _workout_session),
    (re.compile(r"^/api/workout-session-sets/(?P<rid>\d+)(?:/|$)"), "rid", _workout_set_log),
)


def resource_owner_ids(db: Session, path: str) -> set[int] | None:
    """Return the profiles allowed to touch the resource named in ``path``.

    ``None`` means the path is not resource-scoped, or the resource does not
    exist yet (the route will answer 404).
    """
    for pattern, group, resolver in RESOURCE_PATTERNS:
        match = pattern.match(path)
        if match is None:
            continue
        return resolver(db, int(match.group(group)))
    return None
