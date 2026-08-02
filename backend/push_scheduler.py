import hashlib
import json
import logging
import threading
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush
from requests.exceptions import RequestException
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from config import Settings
from models.habit import Habit, HabitCheckIn, habit_is_scheduled
from models.push import AnahiBriefing, PushDelivery, PushSubscription
from models.shopping import ShoppingList
from models.task import Task
from models.user import User
from services.anahi import AnahiServiceError, generate_anahi_briefing
from services.anahi_context import build_anahi_context
from services.push_deliveries import WEB_PUSH_SUBSCRIPTION_FAILURE_STATUSES
from services.shopping_scope import shopping_household_user_ids

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Reminder:
    key: str
    title: str
    body: str
    url: str
    scheduled_for: datetime


def _dates_between(start: date, end: date) -> list[date]:
    return [
        start + timedelta(days=offset)
        for offset in range((end - start).days + 1)
    ]


def _is_due(when: datetime, now: datetime, lookback: timedelta) -> bool:
    return now - lookback <= when <= now


def _reminders_for_user(
    db: Session,
    user_id: int,
    now: datetime,
    lookback: timedelta,
) -> list[Reminder]:
    first_date = (now - lookback).date()
    dates = _dates_between(first_date, now.date())
    reminders: list[Reminder] = []

    habits = db.query(Habit).filter(Habit.user_id == user_id).all()
    checked_habits = {
        (habit_id, check_date)
        for habit_id, check_date in (
            db.query(HabitCheckIn.habit_id, HabitCheckIn.date)
            .join(Habit, Habit.id == HabitCheckIn.habit_id)
            .filter(
                Habit.user_id == user_id,
                HabitCheckIn.date >= first_date,
                HabitCheckIn.date <= now.date(),
            )
            .all()
        )
    }
    for check_date in dates:
        for habit in habits:
            due_at = datetime.combine(check_date, habit.time, tzinfo=now.tzinfo)
            if (
                habit.created_at <= check_date
                and (habit.id, check_date) not in checked_habits
                and habit_is_scheduled(habit, check_date)
                and _is_due(due_at, now, lookback)
            ):
                reminders.append(
                    Reminder(
                        key=f"habit-{habit.id}-{check_date.isoformat()}",
                        title="Hora do seu hábito",
                        body=habit.name,
                        url="/habits",
                        scheduled_for=due_at,
                    )
                )

    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.date >= first_date,
            Task.date <= now.date(),
            Task.completed_at.is_(None),
        )
        .all()
    )
    for task in tasks:
        due_at = datetime.combine(task.date, task.time, tzinfo=now.tzinfo)
        if _is_due(due_at, now, lookback):
            reminders.append(
                Reminder(
                    key=f"task-{task.id}-{task.date.isoformat()}",
                    title="Tarefa planejada",
                    body=task.name,
                    url="/tasks",
                    scheduled_for=due_at,
                )
            )

    shopping_lists = (
        db.query(ShoppingList)
        .filter(
            ShoppingList.user_id.in_(shopping_household_user_ids(db, user_id)),
            ShoppingList.planned_date >= first_date,
            ShoppingList.planned_date <= now.date(),
            ShoppingList.completed_at.is_(None),
        )
        .all()
    )
    for shopping_list in shopping_lists:
        due_at = datetime.combine(
            shopping_list.planned_date,
            time(8, 0),
            tzinfo=now.tzinfo,
        )
        if _is_due(due_at, now, lookback):
            reminders.append(
                Reminder(
                    key=(
                        f"shopping-{shopping_list.id}-"
                        f"{shopping_list.planned_date.isoformat()}"
                    ),
                    title="Compra planejada",
                    body=f"{shopping_list.name} está na sua agenda.",
                    url="/shopping",
                    scheduled_for=due_at,
                )
            )

    return sorted(reminders, key=lambda item: (item.scheduled_for, item.key))


def _due_briefings(
    db: Session,
    user_id: int,
    now: datetime,
    lookback: timedelta,
) -> list[tuple[str, datetime]]:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.briefing_enabled:
        return []
    due = [
        (f"anahi-briefing-{user_id}-{briefing_date.isoformat()}", due_at)
        for briefing_date in _dates_between((now - lookback).date(), now.date())
        if _is_due(
            due_at := datetime.combine(
                briefing_date,
                user.briefing_time,
                tzinfo=now.tzinfo,
            ),
            now,
            lookback,
        )
    ]
    # A briefing summarizes current context, so only the newest missed one is
    # useful after an outage; regular reminders retain every due occurrence.
    return due[-1:]


def _delivery_exists(
    db: Session,
    subscription_id: int,
    reminder_key: str,
) -> bool:
    return (
        db.query(PushDelivery.id)
        .filter(
            PushDelivery.subscription_id == subscription_id,
            PushDelivery.reminder_key == reminder_key,
        )
        .first()
        is not None
    )


def _store_briefing(
    db: Session,
    user_id: int,
    briefing_date: date,
    body: str | None,
    now: datetime,
) -> AnahiBriefing:
    candidate = AnahiBriefing(
        user_id=user_id,
        briefing_date=briefing_date,
        body=body,
        created_at=now,
    )
    try:
        with db.begin_nested():
            db.add(candidate)
            db.flush()
        return candidate
    except IntegrityError:
        existing = (
            db.query(AnahiBriefing)
            .filter(
                AnahiBriefing.user_id == user_id,
                AnahiBriefing.briefing_date == briefing_date,
            )
            .one()
        )
        return existing


def _build_briefing_reminder(
    db: Session,
    user_id: int,
    scheduled_for: datetime,
    now: datetime,
    settings: Settings,
    reminder_key: str,
) -> Reminder | None:
    briefing_date = scheduled_for.date()
    existing = (
        db.query(AnahiBriefing)
        .filter(
            AnahiBriefing.user_id == user_id,
            AnahiBriefing.briefing_date == briefing_date,
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
            scheduled_for=scheduled_for,
        )

    context = build_anahi_context(
        db,
        user_id,
        today=briefing_date,
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
        _store_briefing(db, user_id, briefing_date, None, now)
        return None

    stored = _store_briefing(db, user_id, briefing_date, body, now)
    if not stored.body:
        return None
    return Reminder(
        key=reminder_key,
        title="Bom dia com a ANAHÍ",
        body=stored.body,
        url="/today",
        scheduled_for=scheduled_for,
    )


def _enqueue_delivery(
    db: Session,
    user_id: int,
    subscription_id: int,
    reminder: Reminder,
    now: datetime,
    expires_at: datetime,
) -> bool:
    payload = json.dumps(
        {
            "title": reminder.title,
            "body": reminder.body,
            "url": reminder.url,
            "tag": reminder.key,
        },
        ensure_ascii=False,
    )
    values = {
        "user_id": user_id,
        "subscription_id": subscription_id,
        "reminder_key": reminder.key,
        "status": "pending",
        "payload": payload,
        "attempts": 0,
        "next_retry_at": now,
        "last_error": None,
        "scheduled_for": reminder.scheduled_for,
        "expires_at": expires_at,
        "sent_at": None,
        "created_at": now,
        "updated_at": now,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = (
            postgresql_insert(PushDelivery)
            .values(**values)
            .on_conflict_do_nothing(
                constraint="uq_push_deliveries_subscription_reminder"
            )
        )
        return bool(db.execute(statement).rowcount)
    if dialect == "sqlite":
        statement = (
            sqlite_insert(PushDelivery)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=["subscription_id", "reminder_key"]
            )
        )
        return bool(db.execute(statement).rowcount)

    candidate = PushDelivery(**values)
    try:
        with db.begin_nested():
            db.add(candidate)
            db.flush()
        return True
    except IntegrityError:
        return False


def enqueue_due_push_reminders(
    session_factory: sessionmaker,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> int:
    """Persist due payloads before any network delivery is attempted."""
    if not settings.push_enabled or not settings.vapid_private_key:
        return 0

    current = now or datetime.now(ZoneInfo(settings.TIMEZONE))
    lookback = timedelta(hours=settings.PUSH_REMINDER_RECOVERY_HOURS)
    delivery_ttl = timedelta(hours=settings.PUSH_DELIVERY_TTL_HOURS)
    db = session_factory()
    enqueued = 0
    try:
        subscriptions = (
            db.query(PushSubscription)
            .filter(PushSubscription.enabled.is_(True))
            .all()
        )
        subscriptions_by_user: dict[int, list[PushSubscription]] = defaultdict(list)
        for subscription in subscriptions:
            subscriptions_by_user[subscription.user_id].append(subscription)

        for user_id, user_subscriptions in subscriptions_by_user.items():
            reminders = _reminders_for_user(db, user_id, current, lookback)
            for briefing_key, scheduled_for in _due_briefings(
                db,
                user_id,
                current,
                lookback,
            ):
                if all(
                    _delivery_exists(db, subscription.id, briefing_key)
                    for subscription in user_subscriptions
                ):
                    continue
                try:
                    briefing = _build_briefing_reminder(
                        db,
                        user_id,
                        scheduled_for,
                        current,
                        settings,
                        briefing_key,
                    )
                except Exception as exc:
                    logger.error(
                        "Unexpected ANAHÍ briefing error for user %s (%s)",
                        user_id,
                        type(exc).__name__,
                    )
                else:
                    if briefing is not None:
                        reminders.append(briefing)

            for subscription in user_subscriptions:
                for reminder in reminders:
                    enqueued += int(
                        _enqueue_delivery(
                            db,
                            user_id,
                            subscription.id,
                            reminder,
                            current,
                            reminder.scheduled_for + delivery_ttl,
                        )
                    )
        db.commit()
        return enqueued
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _pending_delivery_statement(now: datetime):
    return (
        select(PushDelivery)
        .where(
            PushDelivery.status == "pending",
            or_(
                PushDelivery.next_retry_at.is_(None),
                PushDelivery.next_retry_at <= now,
            ),
        )
        .order_by(PushDelivery.next_retry_at, PushDelivery.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )


def _as_aware(value: datetime, reference: datetime) -> datetime:
    if value.tzinfo is None and reference.tzinfo is not None:
        return value.replace(tzinfo=reference.tzinfo)
    return value


def _mark_failed(delivery: PushDelivery, now: datetime, reason: str) -> None:
    delivery.status = "failed"
    delivery.next_retry_at = None
    delivery.last_error = reason[:255]
    delivery.updated_at = now


def _record_retry(
    delivery: PushDelivery,
    settings: Settings,
    now: datetime,
    reason: str,
) -> None:
    expires_at = _as_aware(delivery.expires_at, now)
    delay_seconds = min(
        settings.PUSH_RETRY_MAX_SECONDS,
        settings.PUSH_RETRY_BASE_SECONDS * (2 ** max(delivery.attempts - 1, 0)),
    )
    next_retry = now + timedelta(seconds=delay_seconds)
    if (
        delivery.attempts >= settings.PUSH_DELIVERY_MAX_ATTEMPTS
        or next_retry >= expires_at
    ):
        _mark_failed(delivery, now, reason)
        return
    delivery.status = "pending"
    delivery.next_retry_at = next_retry
    delivery.last_error = reason[:255]
    delivery.updated_at = now


def _error_summary(exc: Exception, status_code: int | None = None) -> str:
    summary = type(exc).__name__
    if status_code is not None:
        summary = f"{summary} (HTTP {status_code})"
    return summary[:255]


def _retryable_webpush_status(status_code: int | None) -> bool:
    return status_code is None or status_code in {408, 429} or (
        status_code is not None and status_code >= 500
    )


def _push_topic(reminder_key: str) -> str:
    return hashlib.sha256(reminder_key.encode("utf-8")).hexdigest()[:32]


def _deliver_next_pending(
    session_factory: sessionmaker,
    settings: Settings,
    now: datetime,
) -> bool:
    db = session_factory()
    try:
        if db.get_bind().dialect.name == "sqlite":
            # SQLite ignores SELECT FOR UPDATE. Reserving the single writer slot
            # before selecting prevents two local workers from sending one row.
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        delivery = db.execute(_pending_delivery_statement(now)).scalars().first()
        if delivery is None:
            return False

        if _as_aware(delivery.expires_at, now) <= now:
            _mark_failed(delivery, now, "Delivery expired")
            db.commit()
            return True

        subscription = (
            db.query(PushSubscription)
            .filter(PushSubscription.id == delivery.subscription_id)
            .first()
        )
        if subscription is None:
            _mark_failed(delivery, now, "Subscription unavailable")
            db.commit()
            return True
        if not subscription.enabled:
            _mark_failed(delivery, now, "Subscription disabled")
            db.commit()
            return True
        if subscription.user_id != delivery.user_id:
            _mark_failed(delivery, now, "Subscription profile changed")
            db.commit()
            return True

        delivery.attempts += 1
        remaining_seconds = int(
            (_as_aware(delivery.expires_at, now) - now).total_seconds()
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
                data=delivery.payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                ttl=max(60, min(86_400, remaining_seconds)),
                timeout=10,
                headers={"Topic": _push_topic(delivery.reminder_key)},
            )
        except WebPushException as exc:
            status_code = getattr(exc.response, "status_code", None)
            reason = _error_summary(exc, status_code)
            if status_code in WEB_PUSH_SUBSCRIPTION_FAILURE_STATUSES:
                subscription.enabled = False
                _mark_failed(delivery, now, reason)
            elif _retryable_webpush_status(status_code):
                _record_retry(delivery, settings, now, reason)
            else:
                _mark_failed(delivery, now, reason)
            logger.warning(
                "Push delivery %s failed on attempt %s (%s)",
                delivery.id,
                delivery.attempts,
                reason,
            )
        except (OSError, RequestException) as exc:
            reason = _error_summary(exc)
            _record_retry(delivery, settings, now, reason)
            logger.warning(
                "Push delivery %s failed on attempt %s (%s)",
                delivery.id,
                delivery.attempts,
                reason,
            )
        except Exception as exc:
            reason = _error_summary(exc)
            _mark_failed(delivery, now, reason)
            logger.warning(
                "Push delivery %s failed permanently on attempt %s (%s)",
                delivery.id,
                delivery.attempts,
                reason,
            )
        else:
            delivery.status = "sent"
            delivery.sent_at = now
            delivery.next_retry_at = None
            delivery.last_error = None
            delivery.updated_at = now
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def deliver_pending_pushes(
    session_factory: sessionmaker,
    settings: Settings,
    *,
    now: datetime | None = None,
    limit: int | None = None,
    stop_event: threading.Event | None = None,
) -> int:
    """Claim and process due rows, one short transaction per delivery."""
    if not settings.push_enabled or not settings.vapid_private_key:
        return 0
    current = now or datetime.now(ZoneInfo(settings.TIMEZONE))
    batch_size = limit or settings.PUSH_WORKER_BATCH_SIZE
    processed = 0
    while (
        processed < batch_size
        and (stop_event is None or not stop_event.is_set())
        and _deliver_next_pending(session_factory, settings, current)
    ):
        processed += 1
    return processed


def cleanup_push_deliveries(
    session_factory: sessionmaker,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> None:
    current = now or datetime.now(ZoneInfo(settings.TIMEZONE))
    cutoff = current - timedelta(days=settings.PUSH_DELIVERY_RETENTION_DAYS)
    db = session_factory()
    try:
        db.query(PushDelivery).filter(
            PushDelivery.status == "pending",
            PushDelivery.expires_at <= current,
        ).update(
            {
                PushDelivery.status: "failed",
                PushDelivery.next_retry_at: None,
                PushDelivery.last_error: "Delivery expired",
                PushDelivery.updated_at: current,
            },
            synchronize_session=False,
        )
        db.query(PushDelivery).filter(
            PushDelivery.status.in_(("sent", "failed")),
            PushDelivery.created_at < cutoff,
        ).delete(synchronize_session=False)
        db.query(AnahiBriefing).filter(
            AnahiBriefing.created_at < cutoff,
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run_push_cycle(
    session_factory: sessionmaker,
    settings: Settings,
    *,
    now: datetime | None = None,
    stop_event: threading.Event | None = None,
) -> dict[str, int]:
    current = now or datetime.now(ZoneInfo(settings.TIMEZONE))
    enqueued = enqueue_due_push_reminders(
        session_factory,
        settings,
        now=current,
    )
    processed = deliver_pending_pushes(
        session_factory,
        settings,
        now=current,
        stop_event=stop_event,
    )
    cleanup_push_deliveries(session_factory, settings, now=current)
    return {"enqueued": enqueued, "processed": processed}


def send_due_push_reminders(
    session_factory: sessionmaker,
    settings: Settings,
) -> None:
    """Run one durable cycle; retained as the test and maintenance entrypoint."""
    run_push_cycle(session_factory, settings)
