import hashlib
from datetime import datetime
from zoneinfo import ZoneInfo

from config import Settings
from models.habit import Habit
from models.push import PushDelivery, PushSubscription
from push_scheduler import send_due_push_reminders


def test_push_config_is_protected_and_disabled_without_vapid(
    client,
    auth_headers,
    user_id,
):
    assert client.get(f"/api/users/{user_id}/push-config").status_code == 401

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
