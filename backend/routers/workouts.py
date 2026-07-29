from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from database import get_db
from models.user import User
from models.workout import Workout, Exercise
from schemas.workout import WorkoutResponse, WorkoutCreate, WorkoutsUpdateRequest

router = APIRouter(prefix="/api", tags=["workouts"])


def serialize_workout(workout: Workout) -> dict:
    """Serialize workout with exercises."""
    return {
        "id": workout.id,
        "user_id": workout.user_id,
        "day": workout.day,
        "title": workout.title,
        "note": workout.note or "",
        "exercises": [
            {
                "id": ex.id,
                "name": ex.name,
                "sets": ex.sets or "",
                "reps": ex.reps or ""
            }
            for ex in workout.exercises
        ]
    }


@router.get("/users/{user_id}/workouts", response_model=List[WorkoutResponse])
def list_workouts(user_id: int, db: Session = Depends(get_db)):
    """List all workouts for a user."""
    workouts = db.query(Workout).filter(Workout.user_id == user_id).order_by(
        Workout.id
    ).all()
    return [serialize_workout(w) for w in workouts]


@router.put("/users/{user_id}/workouts", response_model=List[WorkoutResponse])
def update_workouts(user_id: int, data: WorkoutsUpdateRequest, db: Session = Depends(get_db)):
    """Update all workouts for a user (replace all)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        # ORM deletion preserves cascades for exercises on every supported DB.
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
