import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest
from pydantic import SecretStr
from pywebpush import WebPushException
from requests import Response
from sqlalchemy.dialects import postgresql

from config import Settings
from database import init_db
from models.habit import Habit
from models.push import AnahiBriefing, PushDelivery, PushSubscription
from models.shopping import ShoppingList, ShoppingPair
from models.user import User
from push_scheduler import (
    _pending_delivery_statement,
    deliver_pending_pushes,
    send_due_push_reminders,
)
from services.anahi import AnahiUnavailableError


class FrozenDateTime(datetime):
    current = datetime(2026, 8, 1, 7, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz is None else cls.current.astimezone(tz)


def seed_pending_delivery(context, user_id, endpoint, now):
    db = context.session_factory()
    try:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.flush()
        db.add(PushDelivery(
            user_id=user_id,
            subscription_id=subscription.id,
            reminder_key=f"status-{endpoint.rsplit('/', 1)[-1]}",
            status="pending",
            payload="{}",
            attempts=0,
            next_retry_at=now,
            scheduled_for=now,
            expires_at=now + timedelta(hours=1),
            created_at=now,
            updated_at=now,
        ))
        db.commit()
        return subscription.id
    finally:
        db.close()


def test_push_config_is_protected_and_disabled_without_vapid(
    client,
    auth_headers,
    user_id,
):
    assert client.get(f"/api/users/{user_id}/push-config").status_code == 401
    assert client.post(
        f"/api/users/{user_id}/push-subscription/status",
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/test"},
    ).status_code == 401

    config = client.get(
        f"/api/users/{user_id}/push-config",
        headers=auth_headers,
    )
    assert config.status_code == 200
    assert config.json() == {
        "enabled": False,
        "public_key": None,
        "delivery_status": "disabled",
        "delivery_mode": "disabled",
        "last_cycle_at": None,
    }

    unavailable = client.put(
        f"/api/users/{user_id}/push-subscription",
        headers=auth_headers,
        json={
            "endpoint": "https://fcm.googleapis.com/fcm/send/test",
            "keys": {
                "p256dh": "abcdefgh",
                "auth": "abcdefgh",
            },
        },
    )
    assert unavailable.status_code == 503

    test_unavailable = client.post(
        f"/api/users/{user_id}/push-test",
        headers=auth_headers,
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/test"},
    )
    assert test_unavailable.status_code == 503

    unsafe_endpoint = client.put(
        f"/api/users/{user_id}/push-subscription",
        headers=auth_headers,
        json={
            "endpoint": "https://127.0.0.1/internal",
            "keys": {
                "p256dh": "abcdefgh",
                "auth": "abcdefgh",
            },
        },
    )
    assert unsafe_endpoint.status_code == 422


def test_profile_can_configure_anahi_briefing(client, auth_headers, user_id):
    initial = client.get(
        f"/api/users/{user_id}/briefing-settings",
        headers=auth_headers,
    )
    assert initial.status_code == 200
    assert initial.json() == {"enabled": False, "time": "07:30"}

    updated = client.put(
        f"/api/users/{user_id}/briefing-settings",
        headers=auth_headers,
        json={"enabled": True, "time": "06:45"},
    )
    assert updated.status_code == 200
    assert updated.json() == {"enabled": True, "time": "06:45"}

    invalid = client.put(
        f"/api/users/{user_id}/briefing-settings",
        headers=auth_headers,
        json={"enabled": True, "time": "25:00"},
    )
    assert invalid.status_code == 422


def test_scheduler_generates_and_sends_one_briefing_per_day(
    context,
    user_id,
    monkeypatch,
):
    now = FrozenDateTime.current
    endpoint = "https://fcm.googleapis.com/fcm/send/anahi-briefing"
    db = context.session_factory()
    try:
        user = db.query(User).filter(User.id == user_id).one()
        user.briefing_enabled = True
        user.briefing_time = now.time().replace(tzinfo=None)
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
        subscription_id = subscription.id
    finally:
        db.close()

    generated_contexts: list[dict] = []
    sent_payloads: list[dict] = []

    def fake_briefing(_settings, context):
        generated_contexts.append(context)
        return "Você tem uma tarefa e dois hábitos. Comece com cinco minutos."

    monkeypatch.setattr("push_scheduler.datetime", FrozenDateTime)
    monkeypatch.setattr("push_scheduler.generate_anahi_briefing", fake_briefing)
    monkeypatch.setattr("push_scheduler.webpush", lambda **kwargs: sent_payloads.append(kwargs))
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        GEMINI_API_KEY="server-only-test-key",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        VAPID_SUBJECT="mailto:test@example.com",
    )

    send_due_push_reminders(context.session_factory, settings)
    send_due_push_reminders(context.session_factory, settings)

    briefing_payloads = [
        json.loads(item["data"])
        for item in sent_payloads
        if json.loads(item["data"])["tag"].startswith("anahi-briefing-")
    ]
    assert len(generated_contexts) == 1
    assert set(generated_contexts[0]) == {
        "profile",
        "reference_date",
        "habits",
        "tasks",
    }
    assert briefing_payloads == [{
        "title": "Bom dia com a ANAHÍ",
        "body": "Você tem uma tarefa e dois hábitos. Comece com cinco minutos.",
        "url": "/today",
        "tag": f"anahi-briefing-{user_id}-2026-08-01",
    }]

    db = context.session_factory()
    try:
        assert db.query(AnahiBriefing).filter_by(user_id=user_id).count() == 1
        assert db.query(PushDelivery).filter_by(
            subscription_id=subscription_id,
            reminder_key=f"anahi-briefing-{user_id}-2026-08-01",
        ).count() == 1
        delivery = db.query(PushDelivery).filter_by(
            subscription_id=subscription_id,
            reminder_key=f"anahi-briefing-{user_id}-2026-08-01",
        ).one()
        assert delivery.status == "sent"
        assert delivery.attempts == 1
        assert json.loads(delivery.payload) == briefing_payloads[0]
    finally:
        db.close()


def test_briefing_failure_is_skipped_without_blocking_regular_reminders(
    context,
    user_id,
    monkeypatch,
):
    now = FrozenDateTime.current
    endpoint = "https://fcm.googleapis.com/fcm/send/anahi-failure"
    db = context.session_factory()
    try:
        user = db.query(User).filter(User.id == user_id).one()
        user.briefing_enabled = True
        user.briefing_time = now.time().replace(tzinfo=None)
        db.add(Habit(
            user_id=user_id,
            name="Beber água",
            time=now.time().replace(tzinfo=None),
            active_days="0,1,2,3,4,5,6",
            created_at=now.date(),
        ))
        db.add(PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        ))
        db.commit()
    finally:
        db.close()

    attempts = 0
    sent_payloads: list[dict] = []

    def unavailable(_settings, _context):
        nonlocal attempts
        attempts += 1
        raise AnahiUnavailableError

    monkeypatch.setattr("push_scheduler.datetime", FrozenDateTime)
    monkeypatch.setattr("push_scheduler.generate_anahi_briefing", unavailable)
    monkeypatch.setattr("push_scheduler.webpush", lambda **kwargs: sent_payloads.append(kwargs))
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        GEMINI_API_KEY="server-only-test-key",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        VAPID_SUBJECT="mailto:test@example.com",
    )

    send_due_push_reminders(context.session_factory, settings)
    send_due_push_reminders(context.session_factory, settings)

    payloads = [json.loads(item["data"]) for item in sent_payloads]
    assert attempts == 1
    assert any(payload["title"] == "Hora do seu hábito" for payload in payloads)
    assert not any(payload["tag"].startswith("anahi-briefing-") for payload in payloads)
    db = context.session_factory()
    try:
        skipped = db.query(AnahiBriefing).filter_by(user_id=user_id).one()
        assert skipped.body is None
    finally:
        db.close()


def test_scheduler_sends_each_due_reminder_once(
    context,
    user_id,
    monkeypatch,
):
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        db.add(
            Habit(
                user_id=user_id,
                name="Beber água",
                time=now.time().replace(second=0, microsecond=0),
                active_days="0,1,2,3,4,5,6",
                created_at=now.date(),
            )
        )
        subscription = PushSubscription(
            user_id=user_id,
            endpoint="https://fcm.googleapis.com/fcm/send/device-test",
            endpoint_hash=hashlib.sha256(
                b"https://fcm.googleapis.com/fcm/send/device-test"
            ).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
        subscription_id = subscription.id
    finally:
        db.close()

    sent_payloads = []

    def fake_webpush(**kwargs):
        sent_payloads.append(kwargs)

    monkeypatch.setattr("push_scheduler.webpush", fake_webpush)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        VAPID_SUBJECT="mailto:test@example.com",
    )

    send_due_push_reminders(context.session_factory, settings)
    send_due_push_reminders(context.session_factory, settings)

    assert len(sent_payloads) == 1
    assert '"title": "Hora do seu hábito"' in sent_payloads[0]["data"]
    assert 60 <= sent_payloads[0]["ttl"] <= 86_400
    reminder_key = json.loads(sent_payloads[0]["data"])["tag"]
    assert sent_payloads[0]["headers"] == {
        "Topic": hashlib.sha256(reminder_key.encode("utf-8")).hexdigest()[:32]
    }

    db = context.session_factory()
    try:
        deliveries = (
            db.query(PushDelivery)
            .filter(PushDelivery.subscription_id == subscription_id)
            .all()
        )
        assert len(deliveries) == 1
        assert deliveries[0].status == "sent"
        assert deliveries[0].attempts == 1
        assert deliveries[0].next_retry_at is None
    finally:
        db.close()


def test_delivery_retries_from_persisted_payload_after_original_window(
    context,
    user_id,
    monkeypatch,
):
    now = datetime(2026, 8, 1, 10, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    due_at = now - timedelta(minutes=30)
    endpoint = "https://fcm.googleapis.com/fcm/send/durable-retry"
    db = context.session_factory()
    try:
        db.add(
            Habit(
                user_id=user_id,
                name="Pausa para respirar",
                time=due_at.time().replace(tzinfo=None),
                active_days="0,1,2,3,4,5,6",
                created_at=now.date(),
            )
        )
        db.add(
            PushSubscription(
                user_id=user_id,
                endpoint=endpoint,
                endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
                p256dh="abcdefgh",
                auth="abcdefgh",
                enabled=True,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(FrozenDateTime, "current", now)
    monkeypatch.setattr("push_scheduler.datetime", FrozenDateTime)

    def unavailable(**_kwargs):
        raise TimeoutError("must-not-be-persisted-or-logged")

    monkeypatch.setattr("push_scheduler.webpush", unavailable)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        VAPID_SUBJECT="mailto:test@example.com",
    )
    send_due_push_reminders(context.session_factory, settings)

    db = context.session_factory()
    try:
        delivery = db.query(PushDelivery).one()
        persisted_payload = delivery.payload
        assert delivery.status == "pending"
        assert delivery.attempts == 1
        assert delivery.next_retry_at is not None
        assert delivery.last_error == "TimeoutError"
        assert "must-not-be-persisted" not in delivery.last_error
        db.query(Habit).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    sent_payloads: list[dict] = []
    monkeypatch.setattr(
        FrozenDateTime,
        "current",
        now + timedelta(minutes=13),
    )
    monkeypatch.setattr(
        "push_scheduler.webpush",
        lambda **kwargs: sent_payloads.append(kwargs),
    )
    send_due_push_reminders(context.session_factory, settings)

    assert [item["data"] for item in sent_payloads] == [persisted_payload]
    db = context.session_factory()
    try:
        delivery = db.query(PushDelivery).one()
        assert delivery.status == "sent"
        assert delivery.attempts == 2
        assert delivery.next_retry_at is None
        assert delivery.last_error is None
    finally:
        db.close()


def test_pending_claim_uses_postgresql_skip_locked():
    now = datetime(2026, 8, 1, 10, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    sql = str(
        _pending_delivery_statement(now).compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "FOR UPDATE SKIP LOCKED" in sql


def test_delivery_is_failed_after_attempt_limit(
    context,
    user_id,
    monkeypatch,
    caplog,
):
    now = datetime(2026, 8, 1, 11, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    endpoint = "https://fcm.googleapis.com/fcm/send/terminal-retry"
    db = context.session_factory()
    try:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.flush()
        db.add(
            PushDelivery(
                user_id=user_id,
                subscription_id=subscription.id,
                reminder_key="terminal-retry-test",
                status="pending",
                payload=json.dumps({"title": "Persistido"}),
                attempts=0,
                next_retry_at=now,
                last_error=None,
                scheduled_for=now,
                expires_at=now + timedelta(hours=72),
                sent_at=None,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()

    def timeout(**_kwargs):
        raise TimeoutError("sensitive detail")

    monkeypatch.setattr("push_scheduler.webpush", timeout)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        VAPID_SUBJECT="mailto:test@example.com",
        PUSH_DELIVERY_MAX_ATTEMPTS=1,
    )

    assert deliver_pending_pushes(
        context.session_factory,
        settings,
        now=now,
    ) == 1
    assert "sensitive detail" not in caplog.text
    assert "private-key-test" not in caplog.text
    db = context.session_factory()
    try:
        delivery = db.query(PushDelivery).one()
        assert delivery.status == "failed"
        assert delivery.attempts == 1
        assert delivery.next_retry_at is None
        assert delivery.last_error == "TimeoutError"
    finally:
        db.close()


@pytest.mark.parametrize(
    "status_code",
    [400, 401, 403, 404, 410, 413],
)
def test_permanent_webpush_errors_fail_without_retry(
    context,
    user_id,
    monkeypatch,
    status_code,
):
    now = datetime(2026, 8, 1, 11, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))
    endpoint = f"https://fcm.googleapis.com/fcm/send/permanent-{status_code}"
    subscription_id = seed_pending_delivery(context, user_id, endpoint, now)

    def rejected(**_kwargs):
        response = Response()
        response.status_code = status_code
        raise WebPushException("provider response must not be persisted", response)

    monkeypatch.setattr("push_scheduler.webpush", rejected)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
    )

    assert deliver_pending_pushes(context.session_factory, settings, now=now) == 1
    db = context.session_factory()
    try:
        delivery = db.query(PushDelivery).one()
        subscription = db.query(PushSubscription).filter_by(id=subscription_id).one()
        assert delivery.status == "failed"
        assert delivery.next_retry_at is None
        assert delivery.last_error == f"WebPushException (HTTP {status_code})"
        assert subscription.enabled is False
    finally:
        db.close()


@pytest.mark.parametrize("status_code", [408, 429, 500, 503])
def test_transient_webpush_errors_are_retried(
    context,
    user_id,
    monkeypatch,
    status_code,
):
    now = datetime(2026, 8, 1, 11, 45, tzinfo=ZoneInfo("America/Sao_Paulo"))
    endpoint = f"https://fcm.googleapis.com/fcm/send/transient-{status_code}"
    seed_pending_delivery(context, user_id, endpoint, now)

    def unavailable(**_kwargs):
        response = Response()
        response.status_code = status_code
        raise WebPushException("temporary provider response", response)

    monkeypatch.setattr("push_scheduler.webpush", unavailable)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
    )

    assert deliver_pending_pushes(context.session_factory, settings, now=now) == 1
    db = context.session_factory()
    try:
        delivery = db.query(PushDelivery).one()
        assert delivery.status == "pending"
        assert delivery.next_retry_at is not None
        assert delivery.last_error == f"WebPushException (HTTP {status_code})"
    finally:
        db.close()


def test_delivery_batch_stops_after_the_current_webpush_call(
    context,
    user_id,
    monkeypatch,
):
    now = datetime(2026, 8, 1, 11, 50, tzinfo=ZoneInfo("America/Sao_Paulo"))
    seed_pending_delivery(
        context,
        user_id,
        "https://fcm.googleapis.com/fcm/send/stop-first",
        now,
    )
    seed_pending_delivery(
        context,
        user_id,
        "https://fcm.googleapis.com/fcm/send/stop-second",
        now,
    )
    stopped = Event()
    calls: list[dict] = []

    def stop_after_send(**kwargs):
        calls.append(kwargs)
        stopped.set()

    monkeypatch.setattr("push_scheduler.webpush", stop_after_send)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
    )

    assert deliver_pending_pushes(
        context.session_factory,
        settings,
        now=now,
        stop_event=stopped,
    ) == 1
    assert len(calls) == 1
    db = context.session_factory()
    try:
        assert [delivery.status for delivery in db.query(PushDelivery).order_by(
            PushDelivery.id
        )] == ["sent", "pending"]
    finally:
        db.close()

def test_shared_shopping_reminder_reaches_both_profile_subscriptions_once(
    context,
    user_id,
    monkeypatch,
):
    now = datetime(2026, 8, 1, 8, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    endpoints = (
        "https://fcm.googleapis.com/fcm/send/shopping-owner",
        "https://fcm.googleapis.com/fcm/send/shopping-partner",
    )
    db = context.session_factory()
    try:
        partner = (
            db.query(User)
            .filter(User.id != user_id)
            .order_by(User.id)
            .first()
        )
        assert partner is not None
        db.add(
            ShoppingPair(
                owner_user_id=user_id,
                partner_user_id=partner.id,
                invite_code="PUSH3B22",
                created_at=now,
                paired_at=now,
            )
        )
        shopping_list = ShoppingList(
            user_id=user_id,
            name="Compra compartilhada de hoje",
            kind="one_time",
            category="groceries",
            planned_date=now.date(),
            budget_cents=None,
            repeat_enabled=False,
            completed_on=None,
            completed_at=None,
            total_cents=0,
            revision=0,
            created_at=now,
        )
        db.add(shopping_list)
        db.flush()
        subscriptions = []
        for profile_id, endpoint in zip(
            (user_id, partner.id),
            endpoints,
            strict=True,
        ):
            subscription = PushSubscription(
                user_id=profile_id,
                endpoint=endpoint,
                endpoint_hash=hashlib.sha256(
                    endpoint.encode("utf-8"),
                ).hexdigest(),
                p256dh="abcdefgh",
                auth="abcdefgh",
                enabled=True,
                created_at=now,
                updated_at=now,
            )
            db.add(subscription)
            subscriptions.append(subscription)
        db.commit()
        shopping_list_id = shopping_list.id
        subscription_ids = {subscription.id for subscription in subscriptions}
    finally:
        db.close()

    sent_payloads: list[dict] = []
    monkeypatch.setattr(FrozenDateTime, "current", now)
    monkeypatch.setattr("push_scheduler.datetime", FrozenDateTime)
    monkeypatch.setattr(
        "push_scheduler.webpush",
        lambda **kwargs: sent_payloads.append(kwargs),
    )
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        TIMEZONE="America/Sao_Paulo",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
        VAPID_SUBJECT="mailto:test@example.com",
    )

    send_due_push_reminders(context.session_factory, settings)
    send_due_push_reminders(context.session_factory, settings)

    shopping_payloads = [
        json.loads(item["data"])
        for item in sent_payloads
        if json.loads(item["data"])["tag"].startswith("shopping-")
    ]
    reminder_key = f"shopping-{shopping_list_id}-2026-08-01"
    assert [payload["tag"] for payload in shopping_payloads] == [
        reminder_key,
        reminder_key,
    ]
    db = context.session_factory()
    try:
        deliveries = db.query(PushDelivery).filter(
            PushDelivery.subscription_id.in_(subscription_ids),
            PushDelivery.reminder_key == reminder_key,
        ).all()
        assert {delivery.subscription_id for delivery in deliveries} == subscription_ids
        assert len(deliveries) == 2
    finally:
        db.close()


def test_push_test_sends_from_server_to_active_subscription(
    context,
    settings,
    auth_headers,
    user_id,
    monkeypatch,
):
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    endpoint = "https://fcm.googleapis.com/fcm/send/push-test-device"
    db = context.session_factory()
    try:
        db.add(
            PushSubscription(
                user_id=user_id,
                endpoint=endpoint,
                endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
                p256dh="abcdefgh",
                auth="abcdefgh",
                enabled=True,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()

    settings.VAPID_PUBLIC_KEY = "public-key-test"
    settings.VAPID_PRIVATE_KEY = SecretStr("private-key-test")
    sent_payloads = []

    def fake_webpush(**kwargs):
        sent_payloads.append(kwargs)

    monkeypatch.setattr("routers.push.webpush", fake_webpush)
    response = context.client.post(
        f"/api/users/{user_id}/push-test",
        headers=auth_headers,
        json={"endpoint": endpoint},
    )

    assert response.status_code == 200
    assert response.json() == {"sent": 1, "failed": 0, "expired": 0}
    assert len(sent_payloads) == 1
    assert sent_payloads[0]["subscription_info"]["endpoint"] == endpoint
    assert '"title": "Teste do Ritmo' in sent_payloads[0]["data"]
    assert sent_payloads[0]["ttl"] == 60


@pytest.mark.parametrize("status_code", [400, 401, 403, 404, 410, 413])
def test_push_test_disables_permanently_rejected_subscription(
    context,
    settings,
    auth_headers,
    user_id,
    monkeypatch,
    status_code,
):
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    endpoint = f"https://fcm.googleapis.com/fcm/send/push-test-{status_code}"
    db = context.session_factory()
    try:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.commit()
        subscription_id = subscription.id
    finally:
        db.close()

    def rejected(**_kwargs):
        response = Response()
        response.status_code = status_code
        raise WebPushException("provider response must not be exposed", response)

    settings.VAPID_PUBLIC_KEY = "public-key-test"
    settings.VAPID_PRIVATE_KEY = SecretStr("private-key-test")
    monkeypatch.setattr("routers.push.webpush", rejected)

    response = context.client.post(
        f"/api/users/{user_id}/push-test",
        headers=auth_headers,
        json={"endpoint": endpoint},
    )

    assert response.status_code == 200
    assert response.json() == {"sent": 0, "failed": 0, "expired": 1}
    db = context.session_factory()
    try:
        subscription = db.query(PushSubscription).filter_by(id=subscription_id).one()
        assert subscription.enabled is False
    finally:
        db.close()


def test_push_test_never_counts_another_device_as_success(
    context,
    settings,
    auth_headers,
    user_id,
    monkeypatch,
):
    endpoint = "https://fcm.googleapis.com/fcm/send/registered-device"
    missing_endpoint = "https://fcm.googleapis.com/fcm/send/current-but-missing"
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        db.add(PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        ))
        db.commit()
    finally:
        db.close()

    settings.VAPID_PUBLIC_KEY = "public-key-test"
    settings.VAPID_PRIVATE_KEY = SecretStr("private-key-test")
    send = MagicMock()
    monkeypatch.setattr("routers.push.webpush", send)
    response = context.client.post(
        f"/api/users/{user_id}/push-test",
        headers=auth_headers,
        json={"endpoint": missing_endpoint},
    )

    assert response.status_code == 200
    assert response.json() == {"sent": 0, "failed": 0, "expired": 0}
    send.assert_not_called()


def test_push_status_requires_explicit_transfer_between_profiles(
    context,
    settings,
    auth_headers,
    user_id,
):
    endpoint = "https://fcm.googleapis.com/fcm/send/shared-device"
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        other_user = (
            db.query(User)
            .filter(User.id != user_id)
            .order_by(User.id)
            .first()
        )
        assert other_user is not None
        other_user_id = other_user.id
        subscription = PushSubscription(
            user_id=other_user_id,
            endpoint=endpoint,
            endpoint_hash=hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.flush()
        db.add(
            PushDelivery(
                user_id=other_user_id,
                subscription_id=subscription.id,
                reminder_key="pending-before-transfer",
                status="pending",
                payload="{}",
                attempts=0,
                next_retry_at=now,
                scheduled_for=now,
                expires_at=now + timedelta(hours=1),
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()

    status_response = context.client.post(
        f"/api/users/{user_id}/push-subscription/status",
        headers=auth_headers,
        json={"endpoint": endpoint},
    )
    assert status_response.status_code == 200
    assert status_response.json() == {
        "active": False,
        "linked_to_other_profile": True,
    }

    settings.VAPID_PUBLIC_KEY = "public-key-test"
    settings.VAPID_PRIVATE_KEY = SecretStr("private-key-test")
    subscription_payload = {
        "endpoint": endpoint,
        "keys": {"p256dh": "abcdefgh", "auth": "abcdefgh"},
    }
    blocked = context.client.put(
        f"/api/users/{user_id}/push-subscription",
        headers=auth_headers,
        json=subscription_payload,
    )
    assert blocked.status_code == 409

    db = context.session_factory()
    try:
        unchanged = db.query(PushSubscription).filter_by(endpoint=endpoint).one()
        assert unchanged.user_id == other_user_id
        assert unchanged.enabled is True
        pending = db.query(PushDelivery).one()
        assert pending.status == "pending"
    finally:
        db.close()

    transferred = context.client.put(
        f"/api/users/{user_id}/push-subscription",
        headers=auth_headers,
        json={**subscription_payload, "transfer": True},
    )
    assert transferred.status_code == 200
    assert transferred.json() == {"subscribed": True}

    active_status = context.client.post(
        f"/api/users/{user_id}/push-subscription/status",
        headers=auth_headers,
        json={"endpoint": endpoint},
    )
    assert active_status.status_code == 200
    assert active_status.json() == {
        "active": True,
        "linked_to_other_profile": False,
    }

    db = context.session_factory()
    try:
        cancelled = db.query(PushDelivery).one()
        assert cancelled.user_id == other_user_id
        assert cancelled.status == "failed"
        assert cancelled.last_error == "Subscription transferred"
    finally:
        db.close()


def test_worker_rejects_disabled_or_reassigned_subscriptions_without_sending(
    context,
    user_id,
    monkeypatch,
):
    now = datetime(2026, 8, 1, 12, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        other_user = db.query(User).filter(User.id != user_id).first()
        assert other_user is not None
        subscriptions = [
            PushSubscription(
                user_id=user_id,
                endpoint=f"https://fcm.googleapis.com/fcm/send/guard-{suffix}",
                endpoint_hash=hashlib.sha256(f"guard-{suffix}".encode()).hexdigest(),
                p256dh="abcdefgh",
                auth="abcdefgh",
                enabled=True,
                created_at=now,
                updated_at=now,
            )
            for suffix in ("moved", "disabled")
        ]
        db.add_all(subscriptions)
        db.flush()
        for subscription in subscriptions:
            db.add(
                PushDelivery(
                    user_id=user_id,
                    subscription_id=subscription.id,
                    reminder_key=f"guard-{subscription.id}",
                    status="pending",
                    payload="{}",
                    attempts=0,
                    next_retry_at=now,
                    scheduled_for=now,
                    expires_at=now + timedelta(hours=1),
                    created_at=now,
                    updated_at=now,
                )
            )
        subscriptions[0].user_id = other_user.id
        subscriptions[1].enabled = False
        db.commit()
    finally:
        db.close()

    sent: list[dict] = []
    monkeypatch.setattr("push_scheduler.webpush", lambda **kwargs: sent.append(kwargs))
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
    )

    assert deliver_pending_pushes(context.session_factory, settings, now=now) == 2
    assert sent == []
    db = context.session_factory()
    try:
        assert {delivery.last_error for delivery in db.query(PushDelivery).all()} == {
            "Subscription disabled",
            "Subscription profile changed",
        }
        assert {delivery.user_id for delivery in db.query(PushDelivery).all()} == {user_id}
    finally:
        db.close()


def test_sqlite_init_keeps_new_pending_delivery_untouched(context, user_id):
    now = datetime(2026, 8, 1, 13, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint="https://fcm.googleapis.com/fcm/send/init-pending",
            endpoint_hash=hashlib.sha256(b"init-pending").hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.flush()
        db.add(
            PushDelivery(
                user_id=user_id,
                subscription_id=subscription.id,
                reminder_key="pending-survives-restart",
                status="pending",
                payload="{}",
                attempts=0,
                next_retry_at=now,
                scheduled_for=now,
                expires_at=now + timedelta(hours=1),
                sent_at=None,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()

    init_db(bind=context.engine, session_factory=context.session_factory)
    init_db(bind=context.engine, session_factory=context.session_factory)

    db = context.session_factory()
    try:
        delivery = db.query(PushDelivery).one()
        assert delivery.status == "pending"
        assert delivery.attempts == 0
        assert delivery.sent_at is None
    finally:
        db.close()


def test_two_sqlite_workers_send_one_pending_delivery_once(
    context,
    user_id,
    monkeypatch,
):
    now = datetime(2026, 8, 1, 14, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint="https://fcm.googleapis.com/fcm/send/concurrent",
            endpoint_hash=hashlib.sha256(b"concurrent").hexdigest(),
            p256dh="abcdefgh",
            auth="abcdefgh",
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
        db.flush()
        db.add(
            PushDelivery(
                user_id=user_id,
                subscription_id=subscription.id,
                reminder_key="concurrent-claim",
                status="pending",
                payload="{}",
                attempts=0,
                next_retry_at=now,
                scheduled_for=now,
                expires_at=now + timedelta(hours=1),
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()

    sending = Event()
    release = Event()
    calls: list[dict] = []

    def blocked_webpush(**kwargs):
        calls.append(kwargs)
        sending.set()
        assert release.wait(timeout=5)

    monkeypatch.setattr("push_scheduler.webpush", blocked_webpush)
    settings = Settings(
        _env_file=None,
        DEBUG=True,
        DATABASE_URL="sqlite://",
        CORS_ORIGINS="http://localhost:5173",
        VAPID_PUBLIC_KEY="public-key-test",
        VAPID_PRIVATE_KEY="private-key-test",
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            deliver_pending_pushes,
            context.session_factory,
            settings,
            now=now,
            limit=1,
        )
        assert sending.wait(timeout=5)
        second = executor.submit(
            deliver_pending_pushes,
            context.session_factory,
            settings,
            now=now,
            limit=1,
        )
        time.sleep(0.1)
        assert not second.done()
        release.set()
        assert sorted((first.result(timeout=5), second.result(timeout=5))) == [0, 1]

    assert len(calls) == 1
