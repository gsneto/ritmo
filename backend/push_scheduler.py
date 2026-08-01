import asyncio
import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session, sessionmaker

from config import Settings
from models.habit import Habit, HabitCheckIn, habit_is_scheduled
from models.push import AnahiBriefing, PushDelivery, PushSubscription
from models.shopping import ShoppingList
from models.task import Task
from models.user import User
from services.anahi import AnahiServiceError, generate_anahi_briefing
from services.anahi_context import build_anahi_context

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


def _briefing_key_if_due(db: Session, user_id: int, now: datetime) -> str | None:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.briefing_enabled:
        return None
    due_at = datetime.combine(now.date(), user.briefing_time, tzinfo=now.tzinfo)
    if not _is_due(due_at, now):
        return None
    return f"anahi-briefing-{user_id}-{now.date().isoformat()}"


def _was_delivered(db: Session, subscription_id: int, reminder_key: str) -> bool:
    return (
        db.query(PushDelivery.id)
        .filter(
            PushDelivery.subscription_id == subscription_id,
            PushDelivery.reminder_key == reminder_key,
        )
        .first()
        is not None
    )


def _build_briefing_reminder(
    db: Session,
    user_id: int,
    now: datetime,
    settings: Settings,
    reminder_key: str,
) -> Reminder | None:
    existing = (
        db.query(AnahiBriefing)
        .filter(
            AnahiBriefing.user_id == user_id,
            AnahiBriefing.briefing_date == now.date(),
        )
        .first()
    )
    if existing is not None:
        if not existing.body:
            return None
        return Reminder(
            key=reminder_key,
            title="Bom dia com a ANAHÍ",
            body=existing.body,
            url="/today",
        )

    context = build_anahi_context(
        db,
        user_id,
        today=now.date(),
        scopes={"habits", "tasks"},
    )
    if context is None:
        return None
    try:
        body = generate_anahi_briefing(settings, context)
    except AnahiServiceError as exc:
        logger.warning(
            "ANAHÍ briefing skipped for user %s (%s)",
            user_id,
            type(exc).__name__,
        )
        db.add(
            AnahiBriefing(
                user_id=user_id,
                briefing_date=now.date(),
                body=None,
                created_at=now,
            )
        )
        db.commit()
        return None

    db.add(
        AnahiBriefing(
            user_id=user_id,
            briefing_date=now.date(),
            body=body,
            created_at=now,
        )
    )
    db.commit()
    return Reminder(
        key=reminder_key,
        title="Bom dia com a ANAHÍ",
        body=body,
        url="/today",
    )


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
        subscriptions_by_user: dict[int, list[PushSubscription]] = defaultdict(list)
        for subscription in subscriptions:
            subscriptions_by_user[subscription.user_id].append(subscription)

        for user_id, user_subscriptions in subscriptions_by_user.items():
            reminders = _reminders_for_user(db, user_id, now)
            briefing_key = _briefing_key_if_due(db, user_id, now)
            if briefing_key and any(
                not _was_delivered(db, subscription.id, briefing_key)
                for subscription in user_subscriptions
            ):
                try:
                    briefing = _build_briefing_reminder(
                        db,
                        user_id,
                        now,
                        settings,
                        briefing_key,
                    )
                except Exception:
                    logger.exception(
                        "Unexpected ANAHÍ briefing error for user %s",
                        user_id,
                    )
                else:
                    if briefing is not None:
                        reminders.append(briefing)

            for subscription in user_subscriptions:
                for reminder in reminders:
                    if _was_delivered(db, subscription.id, reminder.key):
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
        db.query(AnahiBriefing).filter(
            AnahiBriefing.created_at < cutoff,
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
    """Run reminder delivery without blocking FastAPI request handling.

    This task is process-local. With more than one API replica, each replica
    can race through the delivery check and send the same push before the
    unique database row is committed. The unique constraint prevents duplicate
    delivery records, but not duplicate network sends. Keep push enabled on a
    single replica or add a distributed/advisory lock before scaling out.
    """
    await asyncio.sleep(8)
    while True:
        await asyncio.to_thread(
            send_due_push_reminders,
            session_factory,
            settings,
        )
        await asyncio.sleep(60)
