
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.shopping import ShoppingMonthlyBudget
from models.user import User
from models.workout import WorkoutExercisePreference
from schemas.user import ThemeUpdate, UserResponse, UserUpdate
from seed import create_default_workouts

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db)):
    """List all user profiles."""
    users = db.query(User).all()
    return users


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """Get a specific user by ID."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db)):
    """Update user profile."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.name is not None:
        user.name = data.name
    if data.initials is not None:
        user.initials = data.initials
    if data.theme is not None:
        user.theme = data.theme

    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/theme", response_model=UserResponse)
def update_theme(user_id: int, data: ThemeUpdate, db: Session = Depends(get_db)):
    """Update user theme preference."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.theme = data.theme
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}/data")
def reset_user_data(user_id: int, db: Session = Depends(get_db)):
    """Reset all personal data for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        # ORM deletes honor relationship cascades and leave no orphan rows.
        for habit in list(user.habits):
            db.delete(habit)
        for task in list(user.tasks):
            db.delete(task)
        for workout_session in list(user.workout_sessions):
            db.delete(workout_session)
        for workout in list(user.workouts):
            db.delete(workout)
        for reading_book in list(user.reading_books):
            db.delete(reading_book)
        for shopping_list in list(user.shopping_lists):
            db.delete(shopping_list)
        db.query(ShoppingMonthlyBudget).filter(
            ShoppingMonthlyBudget.user_id == user.id,
        ).delete(synchronize_session=False)
        db.query(WorkoutExercisePreference).filter(
            WorkoutExercisePreference.user_id == user.id,
        ).delete(synchronize_session=False)
        db.flush()

        # Reset means a clean usable app, including the seven default workouts.
        create_default_workouts(db, user.id)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"message": f"Data reset for user {user.name}"}
