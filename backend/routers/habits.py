from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import date, datetime, time as dt_time
from database import get_db
from models.user import User
from models.habit import Habit, HabitCheckIn
from schemas.habit import HabitResponse, HabitCreate, HabitUpdate, CheckInRequest

router = APIRouter(tags=["habits"])


def parse_time(time_str: str) -> dt_time:
    """Parse HH:MM string to time object."""
    parts = time_str.split(":")
    return dt_time(int(parts[0]), int(parts[1]))


def parse_date(date_str: str) -> date:
    """Parse YYYY-MM-DD string to date object."""
    parts = date_str.split("-")
    return date(int(parts[0]), int(parts[1]), int(parts[2]))


def format_date(d: date) -> str:
    """Format date to YYYY-MM-DD string."""
    return d.isoformat()


def format_time(t: dt_time) -> str:
    """Format time to HH:MM string."""
    return f"{t.hour:02d}:{t.minute:02d}"


def serialize_habit(habit: Habit) -> dict:
    """Serialize habit with check_ins as date strings."""
    return {
        "id": habit.id,
        "user_id": habit.user_id,
        "name": habit.name,
        "time": format_time(habit.time),
        "created_at": format_date(habit.created_at),
        "check_ins": [format_date(ci.date) for ci in habit.check_ins]
    }


@router.get("/api/users/{user_id}/habits", response_model=List[HabitResponse])
def list_habits(user_id: int, db: Session = Depends(get_db)):
    """List all habits for a user."""
    habits = db.query(Habit).filter(Habit.user_id == user_id).all()
    return [serialize_habit(h) for h in habits]


@router.post("/api/users/{user_id}/habits", response_model=HabitResponse)
def create_habit(user_id: int, data: HabitCreate, db: Session = Depends(get_db)):
    """Create a new habit."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    habit = Habit(
        user_id=user_id,
        name=data.name,
        time=parse_time(data.time),
        created_at=date.today()
    )
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return serialize_habit(habit)


@router.put("/api/habits/{habit_id}", response_model=HabitResponse)
def update_habit(habit_id: int, data: HabitUpdate, db: Session = Depends(get_db)):
    """Update a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    if data.name is not None:
        habit.name = data.name
    if data.time is not None:
        habit.time = parse_time(data.time)

    db.commit()
    db.refresh(habit)
    return serialize_habit(habit)


@router.delete("/api/habits/{habit_id}")
def delete_habit(habit_id: int, db: Session = Depends(get_db)):
    """Delete a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    db.delete(habit)
    db.commit()
    return {"message": "Habit deleted"}


@router.post("/api/habits/{habit_id}/checkin", response_model=HabitResponse)
def checkin_habit(habit_id: int, data: CheckInRequest, db: Session = Depends(get_db)):
    """Add a check-in to a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    check_date = parse_date(data.date)

    # Check if already checked in
    existing = db.query(HabitCheckIn).filter(
        HabitCheckIn.habit_id == habit_id,
        HabitCheckIn.date == check_date
    ).first()

    if existing:
        return serialize_habit(habit)

    checkin = HabitCheckIn(habit_id=habit_id, date=check_date)
    db.add(checkin)
    db.commit()
    db.refresh(habit)
    return serialize_habit(habit)


@router.delete("/api/habits/{habit_id}/checkin/{date_str}")
def remove_checkin(habit_id: int, date_str: str, db: Session = Depends(get_db)):
    """Remove a check-in from a habit."""
    habit = db.query(Habit).filter(Habit.id == habit_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    check_date = parse_date(date_str)
    checkin = db.query(HabitCheckIn).filter(
        HabitCheckIn.habit_id == habit_id,
        HabitCheckIn.date == check_date
    ).first()

    if checkin:
        db.delete(checkin)
        db.commit()

    return {"message": "Check-in removed"}
