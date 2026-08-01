import hashlib
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic import SecretStr

from config import Settings
from models.habit import Habit
from models.push import AnahiBriefing, PushDelivery, PushSubscription
from models.user import User
from push_scheduler import send_due_push_reminders
from services.anahi import AnahiUnavailableError


class FrozenDateTime(datetime):
    current = datetime(2026, 8, 1, 7, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz is None else cls.current.astimezone(tz)


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
    assert config.json() == {"enabled": False, "public_key": None}

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
    assert sent_payloads[0]["ttl"] == 300

    db = context.session_factory()
    try:
        deliveries = (
            db.query(PushDelivery)
            .filter(PushDelivery.subscription_id == subscription_id)
            .all()
        )
        assert len(deliveries) == 1
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
    )

    assert response.status_code == 200
    assert response.json() == {"sent": 1, "failed": 0, "expired": 0}
    assert len(sent_payloads) == 1
    assert '"title": "Teste do Ritmo' in sent_payloads[0]["data"]
    assert sent_payloads[0]["ttl"] == 60


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
        db.add(
            PushSubscription(
                user_id=other_user_id,
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
