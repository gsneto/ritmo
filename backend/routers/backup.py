import re

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session, selectinload

from config import Settings, get_settings
from database import get_db
from models.habit import Habit, HabitCheckIn, decode_active_days
from models.reading import ReadingBook, ReadingNote, ReadingSession
from models.shopping import ShoppingItem, ShoppingList, ShoppingMonthlyBudget
from models.task import Task
from models.user import User
from models.workout import (
    Exercise,
    Workout,
    WorkoutExercisePreference,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSetLog,
)
from schemas.backup import BackupRestoreResponse, RitmoBackup
from services.calendar_export import build_user_calendar
from services.push_deliveries import cancel_pending_push_deliveries
from services.shopping_scope import shopping_household_user_ids
from time_utils import app_now

router = APIRouter(prefix="/api/users", tags=["backup"])


def _get_user(user_id: int, db: Session) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/{user_id}/export/calendar.ics")
def export_user_calendar(
    user_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Export scheduled habits and unfinished tasks as iCalendar."""
    user = _get_user(user_id, db)
    safe_profile_id = re.sub(r"[^A-Za-z0-9_-]+", "-", user.profile_id).strip("-")
    filename = f"ritmo-{safe_profile_id or user.id}.ics"
    return Response(
        content=build_user_calendar(db, user, settings.TIMEZONE),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{user_id}/backup", response_model=RitmoBackup)
def export_user_backup(user_id: int, db: Session = Depends(get_db)):
    """Export one profile as a portable, versioned JSON document."""
    user = _get_user(user_id, db)
    shopping_budgets = (
        db.query(ShoppingMonthlyBudget)
        .filter(ShoppingMonthlyBudget.user_id == user.id)
        .order_by(ShoppingMonthlyBudget.month)
        .all()
    )
    workout_preferences = (
        db.query(WorkoutExercisePreference)
        .filter(WorkoutExercisePreference.user_id == user.id)
        .order_by(WorkoutExercisePreference.exercise_key)
        .all()
    )
    shopping_lists = (
        db.query(ShoppingList)
        .options(selectinload(ShoppingList.items))
        .filter(
            ShoppingList.user_id.in_(
                shopping_household_user_ids(db, user.id),
            )
        )
        .order_by(ShoppingList.id)
        .all()
    )

    return RitmoBackup.model_validate(
        {
            "version": 2,
            "app": "Ritmo",
            "exported_at": app_now(),
            "profile": {
                "name": user.name,
                "initials": user.initials,
                "theme": user.theme,
            },
            "habits": [
                {
                    "source_id": habit.id,
                    "name": habit.name,
                    "time": habit.time,
                    "active_days": sorted(decode_active_days(habit.active_days)),
                    "created_at": habit.created_at,
                    "check_ins": [checkin.date for checkin in habit.check_ins],
                }
                for habit in user.habits
            ],
            "tasks": [
                {
                    "source_id": task.id,
                    "name": task.name,
                    "date": task.date,
                    "time": task.time,
                    "completed_at": task.completed_at,
                    "recurrence": task.recurrence,
                    "recurrence_interval": task.recurrence_interval,
                    "recurrence_parent_source_id": task.recurrence_parent_id,
                    "created_at": task.created_at,
                }
                for task in user.tasks
            ],
            "shopping_lists": [
                {
                    "source_id": shopping_list.id,
                    "ownership": (
                        "profile"
                        if shopping_list.user_id == user.id
                        else "shared"
                    ),
                    "name": shopping_list.name,
                    "kind": shopping_list.kind,
                    "category": shopping_list.category,
                    "planned_date": shopping_list.planned_date,
                    "budget_cents": shopping_list.budget_cents,
                    "repeat_enabled": shopping_list.repeat_enabled,
                    "next_list_source_id": shopping_list.next_list_id,
                    "completed_on": shopping_list.completed_on,
                    "completed_at": shopping_list.completed_at,
                    "total_cents": shopping_list.total_cents,
                    "revision": shopping_list.revision,
                    "created_at": shopping_list.created_at,
                    "items": [
                        {
                            "source_id": item.id,
                            "name": item.name,
                            "quantity": item.quantity,
                            "checked_at": item.checked_at,
                            "unit_price_cents": item.unit_price_cents,
                            "price_cents": item.price_cents,
                            "created_at": item.created_at,
                        }
                        for item in shopping_list.items
                    ],
                }
                for shopping_list in shopping_lists
            ],
            "shopping_budgets": [
                {
                    "month": budget.month,
                    "budget_cents": budget.budget_cents,
                    "created_at": budget.created_at,
                    "updated_at": budget.updated_at,
                }
                for budget in shopping_budgets
            ],
            "workouts": [
                {
                    "source_id": workout.id,
                    "day": workout.day,
                    "title": workout.title,
                    "note": workout.note,
                    "exercises": [
                        {
                            "source_id": exercise.id,
                            "name": exercise.name,
                            "sets": exercise.sets,
                            "reps": exercise.reps,
                        }
                        for exercise in workout.exercises
                    ],
                }
                for workout in user.workouts
            ],
            "workout_sessions": [
                {
                    "source_id": workout_session.id,
                    "source_workout_id": workout_session.workout_id,
                    "workout_title": workout_session.workout_title,
                    "workout_day": workout_session.workout_day,
                    "status": workout_session.status,
                    "rest_seconds": workout_session.rest_seconds,
                    "started_at": workout_session.started_at,
                    "completed_at": workout_session.completed_at,
                    "duration_seconds": workout_session.duration_seconds,
                    "revision": workout_session.revision,
                    "exercises": [
                        {
                            "source_exercise_id": session_exercise.exercise_id,
                            "name": session_exercise.name,
                            "target_sets": session_exercise.target_sets,
                            "planned_reps": session_exercise.planned_reps,
                            "sort_order": session_exercise.sort_order,
                            "sets": [
                                {
                                    "set_number": set_log.set_number,
                                    "weight_kg": set_log.weight_kg,
                                    "reps_completed": set_log.reps_completed,
                                    "completed_at": set_log.completed_at,
                                }
                                for set_log in session_exercise.sets
                            ],
                        }
                        for session_exercise in workout_session.exercises
                    ],
                }
                for workout_session in user.workout_sessions
            ],
            "workout_preferences": [
                {
                    "exercise_key": preference.exercise_key,
                    "display_name": preference.display_name,
                    "rest_seconds": preference.rest_seconds,
                    "increment_kg": preference.increment_kg,
                }
                for preference in workout_preferences
            ],
            "reading_books": [
                {
                    "source_id": book.id,
                    "title": book.title,
                    "current_page": book.current_page,
                    "total_pages": book.total_pages,
                    "notes": book.notes,
                    "status": book.status,
                    "is_active": book.is_active,
                    "completed_at": book.completed_at,
                    "created_at": book.created_at,
                    "updated_at": book.updated_at,
                    "sessions": [
                        {
                            "session_date": session.session_date,
                            "start_page": session.start_page,
                            "end_page": session.end_page,
                            "duration_minutes": session.duration_minutes,
                            "source": session.source,
                            "created_at": session.created_at,
                        }
                        for session in book.sessions
                    ],
                    "reading_notes": [
                        {
                            "note_date": note.note_date,
                            "page": note.page,
                            "content": note.content,
                            "created_at": note.created_at,
                            "updated_at": note.updated_at,
                        }
                        for note in book.reading_notes
                    ],
                }
                for book in user.reading_books
            ],
        }
    )


def _delete_current_user_data(user: User, db: Session) -> None:
    db.query(WorkoutExercisePreference).filter(
        WorkoutExercisePreference.user_id == user.id,
    ).delete(synchronize_session=False)
    db.query(ShoppingMonthlyBudget).filter(
        ShoppingMonthlyBudget.user_id == user.id,
    ).delete(synchronize_session=False)
    for collection in (
        user.habits,
        user.tasks,
        user.workout_sessions,
        user.workouts,
        user.reading_books,
        user.shopping_lists,
    ):
        for item in list(collection):
            db.delete(item)
    db.flush()


@router.put(
    "/{user_id}/backup",
    response_model=BackupRestoreResponse,
)
def restore_user_backup(
    user_id: int,
    backup: RitmoBackup,
    db: Session = Depends(get_db),
):
    """Replace one profile's data atomically with a validated Ritmo backup."""
    user = _get_user(user_id, db)

    try:
        cancel_pending_push_deliveries(
            db,
            user_id=user.id,
            reason="Profile backup restored",
            now=app_now(),
        )
        _delete_current_user_data(user, db)
        user.name = backup.profile.name
        user.initials = backup.profile.initials
        user.theme = backup.profile.theme

        for source in backup.habits:
            habit = Habit(
                user_id=user.id,
                name=source.name,
                time=source.time,
                active_days=",".join(str(day) for day in source.active_days),
                created_at=source.created_at,
            )
            habit.check_ins = [
                HabitCheckIn(date=checkin_date)
                for checkin_date in source.check_ins
            ]
            db.add(habit)

        task_map: dict[int, Task] = {}
        for source in backup.tasks:
            task = Task(
                user_id=user.id,
                name=source.name,
                date=source.date,
                time=source.time,
                completed_at=source.completed_at,
                recurrence=source.recurrence,
                recurrence_interval=source.recurrence_interval,
                created_at=source.created_at,
            )
            db.add(task)
            db.flush()
            task_map[source.source_id] = task
        for source in backup.tasks:
            if source.recurrence_parent_source_id is not None:
                task_map[source.source_id].recurrence_parent_id = (
                    task_map[source.recurrence_parent_source_id].id
                )

        shopping_map: dict[int, ShoppingList] = {}
        for source in backup.shopping_lists:
            if source.ownership == "shared":
                continue
            shopping_list = ShoppingList(
                user_id=user.id,
                name=source.name,
                kind=source.kind,
                category=source.category,
                planned_date=source.planned_date,
                budget_cents=source.budget_cents,
                repeat_enabled=source.repeat_enabled,
                completed_on=source.completed_on,
                completed_at=source.completed_at,
                total_cents=source.total_cents,
                revision=source.revision,
                created_at=source.created_at,
                items=[
                    ShoppingItem(
                        name=item.name,
                        quantity=item.quantity,
                        checked_at=item.checked_at,
                        unit_price_cents=item.unit_price_cents,
                        price_cents=item.price_cents,
                        created_at=item.created_at,
                    )
                    for item in source.items
                ],
            )
            db.add(shopping_list)
            db.flush()
            shopping_map[source.source_id] = shopping_list
        for source in backup.shopping_lists:
            if (
                source.source_id in shopping_map
                and source.next_list_source_id in shopping_map
            ):
                shopping_map[source.source_id].next_list_id = (
                    shopping_map[source.next_list_source_id].id
                )
        for source in backup.shopping_budgets:
            db.add(
                ShoppingMonthlyBudget(
                    user_id=user.id,
                    month=source.month,
                    budget_cents=source.budget_cents,
                    created_at=source.created_at,
                    updated_at=source.updated_at,
                )
            )

        workout_map: dict[int, Workout] = {}
        exercise_map: dict[int, Exercise] = {}
        for source in backup.workouts:
            workout = Workout(
                user_id=user.id,
                day=source.day,
                title=source.title,
                note=source.note,
            )
            db.add(workout)
            db.flush()
            workout_map[source.source_id] = workout
            for source_exercise in source.exercises:
                exercise = Exercise(
                    workout_id=workout.id,
                    name=source_exercise.name,
                    sets=source_exercise.sets,
                    reps=source_exercise.reps,
                )
                db.add(exercise)
                db.flush()
                exercise_map[source_exercise.source_id] = exercise

        for source in backup.workout_sessions:
            workout_session = WorkoutSession(
                user_id=user.id,
                workout_id=(
                    workout_map[source.source_workout_id].id
                    if source.source_workout_id is not None
                    else None
                ),
                idempotency_key=None,
                workout_title=source.workout_title,
                workout_day=source.workout_day,
                status=source.status,
                rest_seconds=source.rest_seconds,
                started_at=source.started_at,
                completed_at=source.completed_at,
                duration_seconds=source.duration_seconds,
                revision=source.revision,
            )
            db.add(workout_session)
            db.flush()
            for source_exercise in source.exercises:
                session_exercise = WorkoutSessionExercise(
                    session_id=workout_session.id,
                    exercise_id=(
                        exercise_map[source_exercise.source_exercise_id].id
                        if source_exercise.source_exercise_id is not None
                        else None
                    ),
                    name=source_exercise.name,
                    target_sets=source_exercise.target_sets,
                    planned_reps=source_exercise.planned_reps,
                    sort_order=source_exercise.sort_order,
                )
                db.add(session_exercise)
                db.flush()
                for source_set in source_exercise.sets:
                    db.add(
                        WorkoutSetLog(
                            session_exercise_id=session_exercise.id,
                            set_number=source_set.set_number,
                            weight_kg=source_set.weight_kg,
                            reps_completed=source_set.reps_completed,
                            completed_at=source_set.completed_at,
                        )
                    )
        for source in backup.workout_preferences:
            db.add(
                WorkoutExercisePreference(
                    user_id=user.id,
                    exercise_key=source.exercise_key,
                    display_name=source.display_name,
                    rest_seconds=source.rest_seconds,
                    increment_kg=source.increment_kg,
                )
            )

        for source in backup.reading_books:
            book = ReadingBook(
                user_id=user.id,
                title=source.title,
                current_page=source.current_page,
                total_pages=source.total_pages,
                notes=source.notes,
                status=source.status,
                is_active=source.is_active,
                completed_at=source.completed_at,
                created_at=source.created_at,
                updated_at=source.updated_at,
            )
            db.add(book)
            db.flush()
            for source_session in source.sessions:
                db.add(
                    ReadingSession(
                        book_id=book.id,
                        session_date=source_session.session_date,
                        start_page=source_session.start_page,
                        end_page=source_session.end_page,
                        duration_minutes=source_session.duration_minutes,
                        source=source_session.source,
                        created_at=source_session.created_at,
                    )
                )
            for source_note in source.reading_notes:
                db.add(
                    ReadingNote(
                        book_id=book.id,
                        note_date=source_note.note_date,
                        page=source_note.page,
                        content=source_note.content,
                        created_at=source_note.created_at,
                        updated_at=source_note.updated_at,
                    )
                )

        db.commit()
    except Exception:
        db.rollback()
        raise

    return BackupRestoreResponse(
        message=f"Backup restored for {user.name}",
        restored={
            "habits": len(backup.habits),
            "tasks": len(backup.tasks),
            "shopping_lists": len(shopping_map),
            "workouts": len(backup.workouts),
            "workout_sessions": len(backup.workout_sessions),
            "reading_books": len(backup.reading_books),
        },
    )
