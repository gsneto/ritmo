import re
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models.user import User
from models.workout import (
    Exercise,
    Workout,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSetLog,
)
from schemas.workout import (
    WorkoutCreate,
    WorkoutHistoryResponse,
    WorkoutResponse,
    WorkoutSessionResponse,
    WorkoutSessionStart,
    WorkoutSetCompletionState,
    WorkoutsUpdateRequest,
)
from time_utils import app_now


router = APIRouter(prefix="/api", tags=["workouts"])
ZERO_WEIGHT = Decimal("0.00")


def serialize_workout(workout: Workout) -> dict:
    """Serialize an editable workout template with exercises."""
    return {
        "id": workout.id,
        "user_id": workout.user_id,
        "day": workout.day,
        "title": workout.title,
        "note": workout.note or "",
        "exercises": [
            {
                "id": exercise.id,
                "name": exercise.name,
                "sets": exercise.sets or "",
                "reps": exercise.reps or "",
            }
            for exercise in workout.exercises
        ],
    }


def _session_loader():
    return selectinload(WorkoutSession.exercises).selectinload(
        WorkoutSessionExercise.sets
    )


def _get_session(session_id: int, db: Session) -> WorkoutSession:
    session = (
        db.query(WorkoutSession)
        .options(_session_loader())
        .filter(WorkoutSession.id == session_id)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Workout session not found")
    return session


def _claim_session(session_id: int, db: Session) -> WorkoutSession:
    """Serialize session mutations through an atomic revision update."""
    result = db.execute(
        update(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .values(revision=WorkoutSession.revision + 1)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Workout session not found")
    return _get_session(session_id, db)


def _claim_session_for_set(set_id: int, db: Session) -> tuple[WorkoutSession, WorkoutSetLog]:
    session_id = (
        select(WorkoutSessionExercise.session_id)
        .join(
            WorkoutSetLog,
            WorkoutSetLog.session_exercise_id == WorkoutSessionExercise.id,
        )
        .where(WorkoutSetLog.id == set_id)
        .scalar_subquery()
    )
    result = db.execute(
        update(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .values(revision=WorkoutSession.revision + 1)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Workout set not found")

    session = (
        db.query(WorkoutSession)
        .options(_session_loader())
        .filter(WorkoutSession.id == session_id)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Workout set not found")
    for exercise in session.exercises:
        for set_log in exercise.sets:
            if set_log.id == set_id:
                return session, set_log
    raise HTTPException(status_code=404, detail="Workout set not found")


def _ensure_active(session: WorkoutSession) -> None:
    if session.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Completed workout sessions cannot be changed",
        )


def _target_sets(value: str | None) -> int:
    """Read the first set count from legacy free-text values such as '3x'."""
    if not value:
        return 3
    match = re.search(r"\d+", value)
    if match is None:
        return 3
    return min(max(int(match.group()), 1), 20)


def _aware_duration_seconds(started_at: datetime, ended_at: datetime) -> int:
    # SQLite can return a naive value even for DateTime(timezone=True).
    if started_at.tzinfo is None and ended_at.tzinfo is not None:
        started_at = started_at.replace(tzinfo=ended_at.tzinfo)
    if ended_at.tzinfo is None and started_at.tzinfo is not None:
        ended_at = ended_at.replace(tzinfo=started_at.tzinfo)
    return max(0, int((ended_at - started_at).total_seconds()))


def serialize_session(session: WorkoutSession) -> dict:
    completed_logs = [
        set_log
        for exercise in session.exercises
        for set_log in exercise.sets
        if set_log.completed_at is not None
    ]
    weights = [
        Decimal(set_log.weight_kg or ZERO_WEIGHT)
        for set_log in completed_logs
    ]
    total_volume = sum(
        (
            Decimal(set_log.weight_kg or ZERO_WEIGHT)
            * Decimal(set_log.reps_completed or 0)
        )
        for set_log in completed_logs
    )
    return {
        "id": session.id,
        "user_id": session.user_id,
        "workout_id": session.workout_id,
        "workout_title": session.workout_title,
        "workout_day": session.workout_day,
        "status": session.status,
        "rest_seconds": session.rest_seconds,
        "started_at": session.started_at,
        "completed_at": session.completed_at,
        "duration_seconds": session.duration_seconds,
        "total_sets": sum(len(exercise.sets) for exercise in session.exercises),
        "completed_sets": len(completed_logs),
        "max_weight_kg": max(weights, default=ZERO_WEIGHT),
        "total_volume_kg": total_volume,
        "exercises": [
            {
                "id": exercise.id,
                "exercise_id": exercise.exercise_id,
                "name": exercise.name,
                "target_sets": exercise.target_sets,
                "planned_reps": exercise.planned_reps,
                "sort_order": exercise.sort_order,
                "sets": [
                    {
                        "id": set_log.id,
                        "set_number": set_log.set_number,
                        "weight_kg": set_log.weight_kg,
                        "reps_completed": set_log.reps_completed,
                        "completed_at": set_log.completed_at,
                    }
                    for set_log in exercise.sets
                ],
            }
            for exercise in session.exercises
        ],
    }


@router.get("/users/{user_id}/workouts", response_model=list[WorkoutResponse])
def list_workouts(user_id: int, db: Session = Depends(get_db)):
    workouts = (
        db.query(Workout)
        .options(selectinload(Workout.exercises))
        .filter(Workout.user_id == user_id)
        .order_by(Workout.id)
        .all()
    )
    return [serialize_workout(workout) for workout in workouts]


@router.put("/users/{user_id}/workouts", response_model=list[WorkoutResponse])
def update_workouts(
    user_id: int,
    data: WorkoutsUpdateRequest,
    db: Session = Depends(get_db),
):
    """Replace the weekly plan while preserving snapshotted session history."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        for workout in list(user.workouts):
            db.delete(workout)
        db.flush()

        new_workouts = []
        for workout_data in data.workouts:
            workout = Workout(
                user_id=user_id,
                day=workout_data.day,
                title=workout_data.title,
                note=workout_data.note,
                exercises=[
                    Exercise(
                        name=exercise_data.name,
                        sets=exercise_data.sets,
                        reps=exercise_data.reps,
                    )
                    for exercise_data in workout_data.exercises
                ],
            )
            db.add(workout)
            new_workouts.append(workout)

        db.commit()
        for workout in new_workouts:
            db.refresh(workout)
    except Exception:
        db.rollback()
        raise

    return [serialize_workout(workout) for workout in new_workouts]


@router.post(
    "/users/{user_id}/workouts/{workout_id}/sessions",
    response_model=WorkoutSessionResponse,
)
def start_workout_session(
    user_id: int,
    workout_id: int,
    data: WorkoutSessionStart,
    db: Session = Depends(get_db),
):
    repeated = (
        db.query(WorkoutSession)
        .options(_session_loader())
        .filter(WorkoutSession.idempotency_key == data.idempotency_key)
        .first()
    )
    if repeated is not None:
        if repeated.user_id != user_id or repeated.workout_id != workout_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key already belongs to another workout",
            )
        return serialize_session(repeated)

    workout = (
        db.query(Workout)
        .options(selectinload(Workout.exercises))
        .filter(Workout.id == workout_id, Workout.user_id == user_id)
        .first()
    )
    if workout is None:
        raise HTTPException(status_code=404, detail="Workout not found")
    if not workout.exercises:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add at least one exercise before starting the workout",
        )

    active = (
        db.query(WorkoutSession.id)
        .filter(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "active",
        )
        .first()
    )
    if active is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Finish active workout session {active.id} first",
        )

    session = WorkoutSession(
        user_id=user_id,
        workout_id=workout.id,
        idempotency_key=data.idempotency_key,
        workout_title=workout.title,
        workout_day=workout.day,
        status="active",
        rest_seconds=data.rest_seconds,
        started_at=app_now(),
        exercises=[],
    )
    for exercise_index, exercise in enumerate(workout.exercises):
        target_sets = _target_sets(exercise.sets)
        session_exercise = WorkoutSessionExercise(
            exercise_id=exercise.id,
            name=exercise.name,
            target_sets=target_sets,
            planned_reps=exercise.reps,
            sort_order=exercise_index,
            sets=[
                WorkoutSetLog(set_number=set_number)
                for set_number in range(1, target_sets + 1)
            ],
        )
        session.exercises.append(session_exercise)

    db.add(session)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        repeated = (
            db.query(WorkoutSession)
            .options(_session_loader())
            .filter(WorkoutSession.idempotency_key == data.idempotency_key)
            .first()
        )
        if repeated is not None:
            return serialize_session(repeated)
        raise
    db.refresh(session)
    return serialize_session(_get_session(session.id, db))


@router.get(
    "/users/{user_id}/workout-sessions/active",
    response_model=WorkoutSessionResponse | None,
)
def get_active_workout_session(user_id: int, db: Session = Depends(get_db)):
    session = (
        db.query(WorkoutSession)
        .options(_session_loader())
        .filter(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "active",
        )
        .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
        .first()
    )
    return serialize_session(session) if session is not None else None


@router.get(
    "/workout-sessions/{session_id}",
    response_model=WorkoutSessionResponse,
)
def get_workout_session(session_id: int, db: Session = Depends(get_db)):
    return serialize_session(_get_session(session_id, db))


@router.put(
    "/workout-session-sets/{set_id}",
    response_model=WorkoutSessionResponse,
)
def set_workout_set_state(
    set_id: int,
    data: WorkoutSetCompletionState,
    db: Session = Depends(get_db),
):
    session, set_log = _claim_session_for_set(set_id, db)
    _ensure_active(session)

    if data.completed:
        normalized_weight = data.weight_kg.quantize(Decimal("0.01"))
        already_equal = (
            set_log.completed_at is not None
            and set_log.weight_kg == normalized_weight
            and set_log.reps_completed == data.reps_completed
        )
        if not already_equal:
            set_log.weight_kg = normalized_weight
            set_log.reps_completed = data.reps_completed
            if set_log.completed_at is None:
                set_log.completed_at = app_now()
    else:
        set_log.completed_at = None
        set_log.weight_kg = None
        set_log.reps_completed = None

    db.commit()
    return serialize_session(_get_session(session.id, db))


@router.post(
    "/workout-sessions/{session_id}/finish",
    response_model=WorkoutSessionResponse,
)
def finish_workout_session(session_id: int, db: Session = Depends(get_db)):
    session = _claim_session(session_id, db)
    if session.status == "completed":
        db.commit()
        return serialize_session(session)

    completed_sets = sum(
        set_log.completed_at is not None
        for exercise in session.exercises
        for set_log in exercise.sets
    )
    if completed_sets == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Complete at least one set before finishing the workout",
        )

    completed_at = app_now()
    session.status = "completed"
    session.completed_at = completed_at
    session.duration_seconds = _aware_duration_seconds(
        session.started_at,
        completed_at,
    )
    db.commit()
    return serialize_session(_get_session(session.id, db))


@router.get(
    "/users/{user_id}/workout-history",
    response_model=WorkoutHistoryResponse,
)
def get_workout_history(
    user_id: int,
    limit: int = Query(default=12, ge=1, le=100),
    db: Session = Depends(get_db),
):
    user_exists = db.query(User.id).filter(User.id == user_id).first()
    if user_exists is None:
        raise HTTPException(status_code=404, detail="User not found")

    sessions = (
        db.query(WorkoutSession)
        .options(_session_loader())
        .filter(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "completed",
        )
        .order_by(WorkoutSession.completed_at.desc(), WorkoutSession.id.desc())
        .limit(limit)
        .all()
    )
    serialized = [serialize_session(session) for session in sessions]
    return {
        "total_sessions": len(serialized),
        "total_minutes": sum(
            int(item["duration_seconds"] or 0)
            for item in serialized
        )
        // 60,
        "completed_sets": sum(int(item["completed_sets"]) for item in serialized),
        "total_volume_kg": sum(
            (Decimal(item["total_volume_kg"]) for item in serialized),
            start=ZERO_WEIGHT,
        ),
        "sessions": serialized,
    }
