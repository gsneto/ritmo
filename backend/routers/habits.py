from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models.habit import Habit, HabitCheckIn
from models.user import User
from schemas.habit import HabitResponse, HabitCreate, HabitUpdate, CheckInRequest
from time_utils import app_today

router = APIRouter(prefix="/api", tags=["habits"])


def format_date(d: date) -> str:
    """Format date to YYYY-MM-DD string."""
    return d.isoformat()


def format_time(t) -> str:
    """Format time to HH:MM string."""
    return t.strftime("%H:%M")


def serialize_habit(habit: Habit) -> dict:
    """Serialize habit with check_ins as date strings."""
    return {
        "id": habit.id,
        "user_id": habit.user_id,
        "name": habit.name,
        "time": format_time(habit.time),
        "created_at": format_date(habit.created_at),
        "check_ins": sorted(format_date(ci.date) for ci in habit.check_ins),
    }


@router.get("/users/{user_id}/habits", response_model=List[HabitResponse])
def list_habits(user_id: int, db: Session = Depends(get_db)):
    """List all habits for a user."""
    habits = db.query(Habit).filter(Habit.user_id == user_id).all()
    return [serialize_habit(h) for h in habits]


@router.post("/users/{user_id}/habits", response_model=HabitResponse)
def create_habit(user_id: int, data: HabitCreate, db: Session = Depends(get_db)):
    """Create a new habit."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    habit = Habit(
        user_id=user_id,
        name=data.name,
        time=data.time,
        created_at=app_today(),
    )
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return serialize_habit(habit)


@router.put("/habits/{habit_id}", response_model=HabitResponse)
def update_habit(habit_id: int, data: HabitUpdate, db: Session = Depends(get_db)):
    """Update a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    if data.name is not None:
        habit.name = data.name
    if data.time is not None:
        habit.time = data.time

    db.commit()
    db.refresh(habit)
    return serialize_habit(habit)


@router.delete("/habits/{habit_id}")
def delete_habit(habit_id: int, db: Session = Depends(get_db)):
    """Delete a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    db.delete(habit)
    db.commit()
    return {"message": "Habit deleted"}


@router.post("/habits/{habit_id}/checkin", response_model=HabitResponse)
def checkin_habit(habit_id: int, data: CheckInRequest, db: Session = Depends(get_db)):
    """Add a check-in to a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    check_date = data.date

    # Check if already checked in
    existing = db.query(HabitCheckIn).filter(
        HabitCheckIn.habit_id == habit_id,
        HabitCheckIn.date == check_date
    ).first()

    if existing:
        return serialize_habit(habit)

    checkin = HabitCheckIn(habit_id=habit_id, date=check_date)
    db.add(checkin)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent/retried request is idempotent thanks to the DB constraint.
        db.rollback()
        habit = db.query(Habit).filter(Habit.id == habit_id).first()
    db.refresh(habit)
    return serialize_habit(habit)


@router.delete("/habits/{habit_id}/checkin/{check_date}")
def remove_checkin(habit_id: int, check_date: date, db: Session = Depends(get_db)):
    """Remove a check-in from a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    checkin = db.query(HabitCheckIn).filter(
        HabitCheckIn.habit_id == habit_id,
        HabitCheckIn.date == check_date
    ).first()

    if checkin:
        db.delete(checkin)
        db.commit()

    return {"message": "Check-in removed"}
