from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import cast

from sqlalchemy.orm import Session

from models.habit import Habit, HabitCheckIn, habit_is_scheduled
from models.reading import ReadingBook, ReadingSession
from models.task import Task
from models.workout import WorkoutSession

MINIMUM_HISTORY_DAYS = 14
ANALYSIS_WINDOW_DAYS = 60
WEEKDAY_NAMES = (
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
    "domingo",
)


def _date_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _average(values: list[float]) -> float:
    return sum(values) / len(values)


def _activity_start(
    habits: list[Habit],
    tasks: list[Task],
    workouts: list[WorkoutSession],
    reading_sessions: list[ReadingSession],
    today: date,
) -> date | None:
    candidates: list[date] = []
    candidates.extend(
        cast(date, habit.created_at) for habit in habits if habit.created_at <= today
    )
    candidates.extend(
        cast(date, task.created_at) for task in tasks if task.created_at <= today
    )
    candidates.extend(
        cast(date, session.completed_at.date())
        for session in workouts
        if session.completed_at is not None and session.completed_at.date() <= today
    )
    candidates.extend(
        cast(date, session.session_date)
        for session in reading_sessions
        if session.session_date <= today
    )
    return min(candidates) if candidates else None


def build_cross_domain_insights(
    db: Session,
    user_id: int,
    today: date,
) -> dict[str, object]:
    """Build conservative, deterministic observations across Ritmo domains."""
    habits = db.query(Habit).filter(Habit.user_id == user_id).all()
    tasks = db.query(Task).filter(Task.user_id == user_id).all()
    workouts = db.query(WorkoutSession).filter(
        WorkoutSession.user_id == user_id,
        WorkoutSession.status == "completed",
    ).all()
    reading_sessions = (
        db.query(ReadingSession)
        .join(ReadingBook, ReadingSession.book_id == ReadingBook.id)
        .filter(ReadingBook.user_id == user_id)
        .all()
    )

    first_activity = _activity_start(
        habits,
        tasks,
        workouts,
        reading_sessions,
        today,
    )
    if first_activity is None:
        return {
            "history_days": 0,
            "minimum_history_days": MINIMUM_HISTORY_DAYS,
            "insights": [],
        }

    start = max(first_activity, today - timedelta(days=ANALYSIS_WINDOW_DAYS - 1))
    history_days = (today - start).days + 1
    if history_days < MINIMUM_HISTORY_DAYS:
        return {
            "history_days": history_days,
            "minimum_history_days": MINIMUM_HISTORY_DAYS,
            "insights": [],
        }

    habit_ids = [habit.id for habit in habits]
    checkins = (
        db.query(HabitCheckIn)
        .filter(
            HabitCheckIn.habit_id.in_(habit_ids),
            HabitCheckIn.date >= start,
            HabitCheckIn.date <= today,
        )
        .all()
        if habit_ids
        else []
    )
    completed_habits = {(checkin.habit_id, checkin.date) for checkin in checkins}
    training_dates = {
        session.completed_at.date()
        for session in workouts
        if session.completed_at is not None and start <= session.completed_at.date() <= today
    }

    daily_habit_rates: dict[date, float] = {}
    morning_done: dict[date, bool] = {}
    for current in _date_range(start, today):
        scheduled = [
            habit
            for habit in habits
            if habit.created_at <= current and habit_is_scheduled(habit, current)
        ]
        if scheduled:
            completed = sum(
                (habit.id, current) in completed_habits for habit in scheduled
            )
            daily_habit_rates[current] = completed / len(scheduled)

        morning = [habit for habit in scheduled if habit.time.hour < 12]
        if morning:
            morning_done[current] = all(
                (habit.id, current) in completed_habits for habit in morning
            )

    insights: list[dict[str, object]] = []
    training_rates = [
        rate for day, rate in daily_habit_rates.items() if day in training_dates
    ]
    non_training_rates = [
        rate for day, rate in daily_habit_rates.items() if day not in training_dates
    ]
    if len(training_rates) >= 2 and len(non_training_rates) >= 2:
        training_percent = round(_average(training_rates) * 100)
        other_percent = round(_average(non_training_rates) * 100)
        delta = training_percent - other_percent
        if delta > 0:
            comparison = f"{delta} pontos percentuais maior"
        elif delta < 0:
            comparison = f"{abs(delta)} pontos percentuais menor"
        else:
            comparison = "igual"
        insights.append(
            {
                "key": "habit_training_days",
                "title": "Treino e hábitos",
                "description": (
                    "Nos dados observados, sua conclusão de hábitos foi "
                    f"{comparison} nos dias com treino "
                    f"({training_percent}% contra {other_percent}%). "
                    "É uma associação, não uma relação de causa."
                ),
                "sample_size": len(training_rates) + len(non_training_rates),
            }
        )

    completed_task_dates = [
        task.date
        for task in tasks
        if task.completed_at is not None and start <= task.date <= today
    ]
    task_weekdays = Counter(task_date.weekday() for task_date in completed_task_dates)
    if len(completed_task_dates) >= 4 and task_weekdays:
        best_weekday, best_count = min(
            task_weekdays.items(),
            key=lambda item: (-item[1], item[0]),
        )
        insights.append(
            {
                "key": "best_task_weekday",
                "title": "Seu dia de tarefas",
                "description": (
                    f"{WEEKDAY_NAMES[best_weekday].capitalize()} foi o dia com mais "
                    f"tarefas concluídas no período: {best_count}."
                ),
                "sample_size": len(completed_task_dates),
            }
        )

    reading_minutes: dict[date, int] = defaultdict(int)
    for session in reading_sessions:
        if start <= session.session_date <= today:
            reading_minutes[cast(date, session.session_date)] += cast(
                int,
                session.duration_minutes,
            )

    reading_when_done = [
        float(reading_minutes.get(day, 0))
        for day, was_done in morning_done.items()
        if was_done
    ]
    reading_when_not_done = [
        float(reading_minutes.get(day, 0))
        for day, was_done in morning_done.items()
        if not was_done
    ]
    if (
        len(reading_when_done) >= 2
        and len(reading_when_not_done) >= 2
        and sum(reading_when_done) + sum(reading_when_not_done) > 0
    ):
        done_average = round(_average(reading_when_done))
        not_done_average = round(_average(reading_when_not_done))
        insights.append(
            {
                "key": "reading_morning_habits",
                "title": "Manhã e leitura",
                "description": (
                    "Nos dias em que todos os hábitos da manhã foram cumpridos, "
                    f"você leu em média {done_average} min; nos demais, "
                    f"{not_done_average} min. É uma associação, não uma relação de causa."
                ),
                "sample_size": len(reading_when_done) + len(reading_when_not_done),
            }
        )

    return {
        "history_days": history_days,
        "minimum_history_days": MINIMUM_HISTORY_DAYS,
        "insights": insights,
    }
