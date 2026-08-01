from datetime import UTC, date, datetime, time, timedelta
from typing import cast
from zoneinfo import ZoneInfo

from icalendar import Calendar, Event
from sqlalchemy.orm import Session

from models.habit import Habit, decode_active_days
from models.task import Task
from models.user import User

ICALENDAR_WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


def _first_scheduled_date(start: date, active_days: set[int]) -> date:
    candidate = start
    for _ in range(7):
        if candidate.weekday() in active_days:
            return candidate
        candidate += timedelta(days=1)
    return start


def _add_timed_event(
    calendar: Calendar,
    *,
    uid: str,
    summary: str,
    starts_at: datetime,
    recurrence: dict[str, object] | None = None,
) -> None:
    event = Event()
    event.add("uid", uid)
    event.add("dtstamp", datetime.now(UTC))
    event.add("summary", summary)
    event.add("dtstart", starts_at)
    event.add("dtend", starts_at + timedelta(minutes=30))
    if recurrence:
        event.add("rrule", recurrence)
    calendar.add_component(event)


def _task_recurrence(task: Task) -> dict[str, object] | None:
    if task.recurrence == "none":
        return None
    return {
        "freq": task.recurrence.upper(),
        "interval": task.recurrence_interval,
    }


def build_user_calendar(db: Session, user: User, timezone_name: str) -> bytes:
    """Build a standards-compliant iCalendar export for one profile."""
    calendar = Calendar()
    calendar.add("prodid", "-//Ritmo//Calendário pessoal//PT-BR")
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")
    calendar.add("x-wr-calname", f"Ritmo — {user.name}")

    app_timezone = ZoneInfo(timezone_name)
    habits = (
        db.query(Habit)
        .filter(Habit.user_id == user.id)
        .order_by(Habit.id)
        .all()
    )
    for habit in habits:
        active_days = decode_active_days(cast(str | None, habit.active_days))
        first_date = _first_scheduled_date(cast(date, habit.created_at), active_days)
        starts_at = datetime.combine(
            first_date,
            cast(time, habit.time),
            tzinfo=app_timezone,
        )
        _add_timed_event(
            calendar,
            uid=f"habit-{habit.id}@ritmo.local",
            summary=f"Hábito: {habit.name}",
            starts_at=starts_at,
            recurrence={
                "freq": "WEEKLY",
                "byday": [ICALENDAR_WEEKDAYS[day] for day in sorted(active_days)],
            },
        )

    tasks = (
        db.query(Task)
        .filter(Task.user_id == user.id, Task.completed_at.is_(None))
        .order_by(Task.date, Task.time, Task.id)
        .all()
    )
    for task in tasks:
        starts_at = datetime.combine(
            cast(date, task.date),
            cast(time, task.time),
            tzinfo=app_timezone,
        )
        _add_timed_event(
            calendar,
            uid=f"task-{task.id}@ritmo.local",
            summary=f"Tarefa: {task.name}",
            starts_at=starts_at,
            recurrence=_task_recurrence(task),
        )

    return calendar.to_ical()
