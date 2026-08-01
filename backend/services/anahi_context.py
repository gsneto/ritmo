"""Build a small, read-only snapshot of one Ritmo profile for ANAHÍ."""

from calendar import monthrange
from datetime import date, timedelta
import unicodedata

from sqlalchemy import Float, cast, func
from sqlalchemy.orm import Session, selectinload

from models.habit import Habit, HabitCheckIn, habit_is_scheduled
from models.reading import ReadingBook, ReadingSession
from models.shopping import ShoppingList
from models.task import Task
from models.user import User
from models.workout import Workout, WorkoutSession
from time_utils import app_today


CONTEXT_SCOPE_ORDER = ("habits", "tasks", "reading", "shopping", "workouts")
READING_CONTEXT_BOOK_LIMIT = 5


def _normalized_question(question: str) -> str:
    normalized = unicodedata.normalize("NFKD", question.casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def select_anahi_scopes(question: str) -> set[str]:
    """Select only the app areas needed to answer the current question."""
    text = _normalized_question(question)
    if any(term in text for term in ("resumo completo", "tudo no app", "meus dados")):
        return set(CONTEXT_SCOPE_ORDER)

    scopes: set[str] = set()
    if any(term in text for term in ("livro", "leitura", "pagina", "biblioteca")):
        scopes.add("reading")
    if any(term in text for term in (
        "compra", "gasto", "finance", "orcamento", "mercado", "preco", "fralda",
    )):
        scopes.add("shopping")
    if any(term in text for term in ("treino", "exercicio", "peso", "serie", "academia")):
        scopes.add("workouts")
    if any(term in text for term in ("habito", "check-in", "checkin")):
        scopes.add("habits")
    if any(term in text for term in (
        "tarefa", "pendente", "prioridade", "prazo", "atrasad", "amanha",
    )):
        scopes.add("tasks")
    if any(term in text for term in ("rotina", "meu dia", "hoje", "agora")):
        scopes.update(("habits", "tasks"))
    return scopes


def _month_bounds(anchor: date) -> tuple[date, date]:
    first = anchor.replace(day=1)
    last = anchor.replace(day=monthrange(anchor.year, anchor.month)[1])
    return first, last


def _previous_month(anchor: date) -> date:
    return (anchor.replace(day=1) - timedelta(days=1)).replace(day=1)


def _format_brl(cents: int) -> str:
    value = f"{cents / 100:,.2f}"
    value = value.replace(",", "_").replace(".", ",").replace("_", ".")
    return f"R$ {value}"


def _shopping_month(db: Session, user_id: int, anchor: date) -> dict:
    first, last = _month_bounds(anchor)
    total_cents, purchase_count = (
        db.query(
            func.coalesce(func.sum(ShoppingList.total_cents), 0),
            func.count(ShoppingList.id),
        )
        .filter(
            ShoppingList.user_id == user_id,
            ShoppingList.completed_on >= first,
            ShoppingList.completed_on <= last,
        )
        .one()
    )
    total = int(total_cents or 0)
    return {
        "month": first.strftime("%Y-%m"),
        "total_cents": total,
        "total_brl": _format_brl(total),
        "purchase_count": int(purchase_count or 0),
    }


def build_anahi_context(
    db: Session,
    user_id: int,
    *,
    today: date | None = None,
    scopes: set[str] | None = None,
) -> dict | None:
    """Return only the selected profile's useful aggregates and recent items."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        return None

    selected_day = today or app_today()
    selected_scopes = set(CONTEXT_SCOPE_ORDER if scopes is None else scopes)

    context = {
        "profile": {"name": user.name},
        "reference_date": selected_day.isoformat(),
    }
    if "reading" in selected_scopes:
        reading_progress = cast(ReadingBook.current_page, Float) / ReadingBook.total_pages
        books = (
            db.query(ReadingBook)
            .filter(
                ReadingBook.user_id == user_id,
                ReadingBook.status == "lendo",
            )
            .order_by(
                reading_progress.desc(),
                ReadingBook.is_active.desc(),
                ReadingBook.current_page.desc(),
                ReadingBook.updated_at.desc(),
            )
            .limit(READING_CONTEXT_BOOK_LIMIT)
            .all()
        )
        closest_book = books[0] if books else None
        week_start = selected_day - timedelta(days=selected_day.weekday())
        weekly_pages, weekly_minutes, weekly_sessions = (
            db.query(
                func.coalesce(
                    func.sum(ReadingSession.end_page - ReadingSession.start_page),
                    0,
                ),
                func.coalesce(func.sum(ReadingSession.duration_minutes), 0),
                func.count(ReadingSession.id),
            )
            .join(ReadingBook, ReadingBook.id == ReadingSession.book_id)
            .filter(
                ReadingBook.user_id == user_id,
                ReadingSession.session_date >= week_start,
                ReadingSession.session_date <= selected_day,
            )
            .one()
        )
        context["reading"] = {
            "books": [
                {
                    "title": book.title,
                    "status": book.status,
                    "current_page": book.current_page,
                    "total_pages": book.total_pages,
                    "progress_percent": book.progress_percent,
                    "is_active": book.is_active,
                }
                for book in books
            ],
            "closest_to_finish": (
                {
                    "title": closest_book.title,
                    "current_page": closest_book.current_page,
                    "total_pages": closest_book.total_pages,
                    "progress_percent": closest_book.progress_percent,
                }
                if closest_book is not None
                else None
            ),
            "this_week": {
                "pages_read": int(weekly_pages or 0),
                "duration_minutes": int(weekly_minutes or 0),
                "session_count": int(weekly_sessions or 0),
            },
        }
    if "shopping" in selected_scopes:
        pending_shopping = (
            db.query(ShoppingList)
            .filter(
                ShoppingList.user_id == user_id,
                ShoppingList.completed_at.is_(None),
            )
            .order_by(ShoppingList.planned_date, ShoppingList.id)
            .limit(12)
            .all()
        )
        context["shopping"] = {
            "current_month": _shopping_month(db, user_id, selected_day),
            "previous_month": _shopping_month(
                db,
                user_id,
                _previous_month(selected_day),
            ),
            "pending_lists": [
                {
                    "name": shopping_list.name,
                    "planned_date": shopping_list.planned_date.isoformat(),
                    "budget_cents": shopping_list.budget_cents,
                    "budget_brl": (
                        _format_brl(shopping_list.budget_cents)
                        if shopping_list.budget_cents is not None
                        else None
                    ),
                }
                for shopping_list in pending_shopping
            ],
        }
    if "habits" in selected_scopes:
        habits = (
            db.query(Habit)
            .filter(Habit.user_id == user_id)
            .order_by(Habit.time, Habit.id)
            .limit(50)
            .all()
        )
        checked_habit_ids = {
            habit_id
            for habit_id, in (
                db.query(HabitCheckIn.habit_id)
                .join(Habit, Habit.id == HabitCheckIn.habit_id)
                .filter(
                    Habit.user_id == user_id,
                    HabitCheckIn.date == selected_day,
                )
                .all()
            )
        }
        habits_today = [
            {
                "name": habit.name,
                "time": habit.time.strftime("%H:%M"),
                "completed": habit.id in checked_habit_ids,
            }
            for habit in habits
            if habit_is_scheduled(habit, selected_day)
        ]
        context["habits"] = {
            "scheduled_today": habits_today,
            "completed_today": sum(item["completed"] for item in habits_today),
            "total_today": len(habits_today),
        }
    if "tasks" in selected_scopes:
        pending_tasks = (
            db.query(Task)
            .filter(
                Task.user_id == user_id,
                Task.completed_at.is_(None),
            )
            .order_by(Task.date, Task.time, Task.id)
            .limit(30)
            .all()
        )
        context["tasks"] = {
            "pending": [
                {
                    "name": task.name,
                    "date": task.date.isoformat(),
                    "time": task.time.strftime("%H:%M"),
                    "status": (
                        "overdue"
                        if task.date < selected_day
                        else "today"
                        if task.date == selected_day
                        else "upcoming"
                    ),
                }
                for task in pending_tasks
            ],
            "overdue_count": sum(task.date < selected_day for task in pending_tasks),
            "today_count": sum(task.date == selected_day for task in pending_tasks),
        }
    if "workouts" in selected_scopes:
        workouts = (
            db.query(Workout)
            .options(selectinload(Workout.exercises))
            .filter(Workout.user_id == user_id)
            .order_by(Workout.id)
            .limit(14)
            .all()
        )
        recent_workouts = (
            db.query(WorkoutSession)
            .filter(
                WorkoutSession.user_id == user_id,
                WorkoutSession.status == "completed",
            )
            .order_by(WorkoutSession.completed_at.desc(), WorkoutSession.id.desc())
            .limit(5)
            .all()
        )
        context["workouts"] = {
            "plans": [
                {
                    "day": workout.day,
                    "title": workout.title,
                    "exercises": [exercise.name for exercise in workout.exercises],
                }
                for workout in workouts
            ],
            "recent_completed": [
                {
                    "title": session.workout_title,
                    "completed_at": (
                        session.completed_at.isoformat()
                        if session.completed_at is not None
                        else None
                    ),
                    "duration_minutes": (
                        round(session.duration_seconds / 60)
                        if session.duration_seconds is not None
                        else None
                    ),
                }
                for session in recent_workouts
            ],
        }
    return context
