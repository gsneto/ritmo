import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session, sessionmaker

from config import Settings
from models.habit import Habit, HabitCheckIn, habit_is_scheduled
from models.push import PushDelivery, PushSubscription
from models.shopping import ShoppingList
from models.task import Task


logger = logging.getLogger(__name__)
REMINDER_GRACE = timedelta(minutes=12)


@dataclass(frozen=True)
class Reminder:
    key: str
    title: str
    body: str
    url: str


def _is_due(when: datetime, now: datetime) -> bool:
    return now - REMINDER_GRACE <= when <= now


def _reminders_for_user(db: Session, user_id: int, now: datetime) -> list[Reminder]:
    today = now.date()
    reminders: list[Reminder] = []

    habits = db.query(Habit).filter(Habit.user_id == user_id).all()
    checked_habit_ids = {
        row[0]
        for row in (
            db.query(HabitCheckIn.habit_id)
            .join(Habit, Habit.id == HabitCheckIn.habit_id)
            .filter(Habit.user_id == user_id, HabitCheckIn.date == today)
            .all()
        )
    }
    for habit in habits:
        due_at = datetime.combine(today, habit.time, tzinfo=now.tzinfo)
        if (
            habit.id not in checked_habit_ids
            and habit_is_scheduled(habit, today)
            and _is_due(due_at, now)
        ):
            reminders.append(
                Reminder(
                    key=f"habit-{habit.id}-{today.isoformat()}",
                    title="Hora do seu hábito",
                    body=habit.name,
                    url="/habits",
                )
            )

    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.date == today,
            Task.completed_at.is_(None),
        )
        .all()
    )
    for task in tasks:
        due_at = datetime.combine(today, task.time, tzinfo=now.tzinfo)
        if _is_due(due_at, now):
            reminders.append(
                Reminder(
                    key=f"task-{task.id}-{today.isoformat()}",
                    title="Tarefa planejada",
                    body=task.name,
                    url="/tasks",
                )
            )

    shopping_lists = (
        db.query(ShoppingList)
        .filter(
            ShoppingList.user_id == user_id,
            ShoppingList.planned_date == today,
            ShoppingList.completed_at.is_(None),
        )
        .all()
    )
    shopping_due_at = datetime.combine(today, time(8, 0), tzinfo=now.tzinfo)
    if _is_due(shopping_due_at, now):
        reminders.extend(
            Reminder(
                key=f"shopping-{shopping_list.id}-{today.isoformat()}",
                title="Compra planejada",
                body=f"{shopping_list.name} está na sua agenda.",
                url="/shopping",
            )
            for shopping_list in shopping_lists
        )

    return reminders


def send_due_push_reminders(
    session_factory: sessionmaker,
    settings: Settings,
) -> None:
    """Send due reminders once per browser subscription.

    This is intentionally safe to call repeatedly; successful deliveries are
    recorded with a unique reminder key.
    """
    if not settings.push_enabled or not settings.vapid_private_key:
        return

    db = session_factory()
    try:
        now = datetime.now(ZoneInfo(settings.TIMEZONE))
        subscriptions = (
            db.query(PushSubscription)
            .filter(PushSubscription.enabled.is_(True))
            .all()
        )
        reminder_cache: dict[int, list[Reminder]] = {}
        for subscription in subscriptions:
            if subscription.user_id not in reminder_cache:
                reminder_cache[subscription.user_id] = _reminders_for_user(
                    db,
                    subscription.user_id,
                    now,
                )
            reminders = reminder_cache[subscription.user_id]
            for reminder in reminders:
                was_delivered = (
                    db.query(PushDelivery.id)
                    .filter(
                        PushDelivery.subscription_id == subscription.id,
                        PushDelivery.reminder_key == reminder.key,
                    )
                    .first()
                    is not None
                )
                if was_delivered:
                    continue

                payload = json.dumps(
                    {
                        "title": reminder.title,
                        "body": reminder.body,
                        "url": reminder.url,
                        "tag": reminder.key,
                    },
                    ensure_ascii=False,
                )
                try:
                    webpush(
                        subscription_info={
                            "endpoint": subscription.endpoint,
                            "keys": {
                                "p256dh": subscription.p256dh,
                                "auth": subscription.auth,
                            },
                        },
                        data=payload,
                        vapid_private_key=settings.vapid_private_key,
                        vapid_claims={"sub": settings.VAPID_SUBJECT},
                        ttl=300,
                        timeout=10,
                    )
                except WebPushException as exc:
                    status_code = getattr(exc.response, "status_code", None)
                    if status_code in {404, 410}:
                        subscription.enabled = False
                        db.commit()
                    else:
                        logger.warning(
                            "Push delivery failed for subscription %s: %s",
                            subscription.id,
                            exc,
                        )
                    continue

                db.add(
                    PushDelivery(
                        subscription_id=subscription.id,
                        reminder_key=reminder.key,
                        created_at=now,
                    )
                )
                db.commit()

        cutoff = now - timedelta(days=90)
        db.query(PushDelivery).filter(
            PushDelivery.created_at < cutoff,
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Unexpected error in push reminder scheduler")
    finally:
        db.close()


async def run_push_scheduler(
    session_factory: sessionmaker,
    settings: Settings,
) -> None:
    """Run reminder delivery without blocking FastAPI request handling."""
    await asyncio.sleep(8)
    while True:
        await asyncio.to_thread(
            send_due_push_reminders,
            session_factory,
            settings,
        )
        await asyncio.sleep(60)
