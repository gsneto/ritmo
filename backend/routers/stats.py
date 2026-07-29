from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.habit import Habit, HabitCheckIn
from models.user import User
from time_utils import app_today

router = APIRouter(prefix="/api", tags=["stats"])
MONTH_LABELS = (
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
)


def ensure_user_exists(user_id: int, db: Session) -> None:
    if db.query(User.id).filter(User.id == user_id).first() is None:
        raise HTTPException(status_code=404, detail="User not found")


@router.get("/users/{user_id}/stats/today")
def get_today_stats(user_id: int, db: Session = Depends(get_db)):
    """Get today's statistics for a user."""
    ensure_user_exists(user_id, db)
    today = app_today()
    habits = db.query(Habit).filter(Habit.user_id == user_id).all()

    # Filter habits active today
    active_habits = [h for h in habits if h.created_at <= today]
    done_count = 0

    for habit in active_habits:
        has_checkin = db.query(HabitCheckIn).filter(
            HabitCheckIn.habit_id == habit.id,
            HabitCheckIn.date == today
        ).first()
        if has_checkin:
            done_count += 1

    total = len(active_habits)
    rate = round((done_count / total) * 100) if total > 0 else 0

    return {
        "today_progress": f"{rate}%",
        "checked_count": f"{done_count} de {total} feitos",
        "habits_today": [
            {
                "id": h.id,
                "name": h.name,
                "time": f"{h.time.hour:02d}:{h.time.minute:02d}",
                "done": bool(db.query(HabitCheckIn).filter(
                    HabitCheckIn.habit_id == h.id,
                    HabitCheckIn.date == today
                ).first())
            }
            for h in sorted(active_habits, key=lambda x: x.time)
        ]
    }


@router.get("/users/{user_id}/stats/monthly")
def get_monthly_stats(user_id: int, db: Session = Depends(get_db)):
    """Get monthly statistics for the last 6 months."""
    ensure_user_exists(user_id, db)
    current = app_today()
    months = []

    for offset in range(5, -1, -1):
        year = current.year
        month = current.month - offset
        while month <= 0:
            month += 12
            year -= 1

        first_day = date(year, month, 1)
        if year == current.year and month == current.month:
            last_day = current
        else:
            last_day = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year + 1, 1, 1) - timedelta(days=1)

        habits = db.query(Habit).filter(
            Habit.user_id == user_id,
            Habit.created_at <= last_day
        ).all()

        available = 0
        completed = 0

        current_day = first_day
        while current_day <= last_day:
            day_habits = [h for h in habits if h.created_at <= current_day]
            available += len(day_habits)

            for h in day_habits:
                checkin = db.query(HabitCheckIn).filter(
                    HabitCheckIn.habit_id == h.id,
                    HabitCheckIn.date == current_day
                ).first()
                if checkin:
                    completed += 1

            current_day += timedelta(days=1)

        score = round((completed / available) * 100) if available > 0 else 0
        months.append({
            "month": MONTH_LABELS[first_day.month - 1],
            "score": score
        })

    return {"months": months}


@router.get("/users/{user_id}/stats/streak")
def get_streak(user_id: int, db: Session = Depends(get_db)):
    """Calculate current streak."""
    ensure_user_exists(user_id, db)
    streak = 0
    today = app_today()

    for offset in range(366):
        check_date = today - timedelta(days=offset)
        habits = db.query(Habit).filter(
            Habit.user_id == user_id,
            Habit.created_at <= check_date
        ).all()

        if not habits:
            break

        all_done = all(
            db.query(HabitCheckIn).filter(
                HabitCheckIn.habit_id == h.id,
                HabitCheckIn.date == check_date
            ).first()
            for h in habits
        )

        if all_done:
            streak += 1
        elif offset > 0:
            break

    return {"streak": streak}


@router.get("/users/{user_id}/stats/week")
def get_week_stats(user_id: int, db: Session = Depends(get_db)):
    """Get last 7 days statistics."""
    ensure_user_exists(user_id, db)
    today = app_today()
    days = []

    for offset in range(6, -1, -1):
        check_date = today - timedelta(days=offset)
        habits = db.query(Habit).filter(
            Habit.user_id == user_id,
            Habit.created_at <= check_date
        ).all()

        done = 0
        for h in habits:
            checkin = db.query(HabitCheckIn).filter(
                HabitCheckIn.habit_id == h.id,
                HabitCheckIn.date == check_date
            ).first()
            if checkin:
                done += 1

        total = len(habits)
        percent = round((done / total) * 100) if total > 0 else 0

        weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
        days.append({
            "day": weekdays[check_date.weekday()],
            "percent": percent,
            "done": done,
            "total": total
        })

    return {"days": days}
