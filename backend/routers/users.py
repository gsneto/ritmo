from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from database import get_db
from models.user import User
from models.habit import Habit
from models.task import Task
from models.workout import Workout
from schemas.user import UserResponse, UserUpdate, ThemeUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=List[UserResponse])
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

    if data.theme not in ["light", "dark"]:
        raise HTTPException(status_code=400, detail="Theme must be 'light' or 'dark'")

    user.theme = data.theme
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}/data")
def reset_user_data(user_id: int, db: Session = Depends(get_db)):
    """Reset all data for a user (habits, tasks, workouts)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Delete all user's data
    db.query(Habit).filter(Habit.user_id == user_id).delete()
    db.query(Task).filter(Task.user_id == user_id).delete()
    db.query(Workout).filter(Workout.user_id == user_id).delete()

    db.commit()

    return {"message": f"Data reset for user {user.name}"}
