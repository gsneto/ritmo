import hashlib
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session

from config import Settings, get_settings
from database import get_db
from models.push import PushSubscription
from models.user import User
from schemas.push import (
    PushConfigResponse,
    PushSubscriptionDelete,
    PushSubscriptionResponse,
    PushSubscriptionStatusRequest,
    PushSubscriptionStatusResponse,
    PushSubscriptionUpsert,
    PushTestResponse,
)
from time_utils import app_now


router = APIRouter(prefix="/api/users", tags=["push"])
logger = logging.getLogger(__name__)


def _endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def _ensure_user(user_id: int, db: Session) -> None:
    if db.query(User.id).filter(User.id == user_id).first() is None:
        raise HTTPException(status_code=404, detail="User not found")


@router.get("/{user_id}/push-config", response_model=PushConfigResponse)
def get_push_config(
    user_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    _ensure_user(user_id, db)
    return PushConfigResponse(
        enabled=settings.push_enabled,
        public_key=(
            settings.VAPID_PUBLIC_KEY.strip()
            if settings.push_enabled and settings.VAPID_PUBLIC_KEY
            else None
        ),
    )


@router.put(
    "/{user_id}/push-subscription",
    response_model=PushSubscriptionResponse,
)
def save_push_subscription(
    user_id: int,
    data: PushSubscriptionUpsert,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    _ensure_user(user_id, db)
    if not settings.push_enabled:
        raise HTTPException(
            status_code=503,
            detail="Push notifications are not configured",
        )

    subscription = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.endpoint_hash == _endpoint_hash(data.endpoint),
            PushSubscription.endpoint == data.endpoint,
        )
        .first()
    )
    now = app_now()
    if subscription is None:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=data.endpoint,
            endpoint_hash=_endpoint_hash(data.endpoint),
            p256dh=data.keys.p256dh,
            auth=data.keys.auth,
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(subscription)
    else:
        if subscription.user_id != user_id and not data.transfer:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This browser is linked to another profile. "
                    "Confirm transfer before replacing that link."
                ),
            )
        # This is intentionally an explicit action from the "Ativar neste
        # perfil" control. Refresh/status checks must never move ownership.
        subscription.user_id = user_id
        subscription.p256dh = data.keys.p256dh
        subscription.auth = data.keys.auth
        subscription.enabled = True
        subscription.updated_at = now
    db.commit()
    return PushSubscriptionResponse(subscribed=True)


@router.post(
    "/{user_id}/push-subscription/status",
    response_model=PushSubscriptionStatusResponse,
)
def get_push_subscription_status(
    user_id: int,
    data: PushSubscriptionStatusRequest,
    db: Session = Depends(get_db),
):
    """Check whether this browser endpoint is enabled for this profile only."""
    _ensure_user(user_id, db)
    subscription = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.endpoint_hash == _endpoint_hash(data.endpoint),
            PushSubscription.endpoint == data.endpoint,
        )
        .first()
    )
    return PushSubscriptionStatusResponse(
        active=bool(
            subscription is not None
            and subscription.user_id == user_id
            and subscription.enabled
        ),
        linked_to_other_profile=bool(
            subscription is not None and subscription.user_id != user_id
        ),
    )


@router.delete(
    "/{user_id}/push-subscription",
    response_model=PushSubscriptionResponse,
)
def delete_push_subscription(
    user_id: int,
    data: PushSubscriptionDelete,
    db: Session = Depends(get_db),
):
    _ensure_user(user_id, db)
    subscription = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint_hash == _endpoint_hash(data.endpoint),
            PushSubscription.endpoint == data.endpoint,
        )
        .first()
    )
    if subscription is not None:
        db.delete(subscription)
        db.commit()
    return PushSubscriptionResponse(subscribed=False)


@router.post(
    "/{user_id}/push-test",
    response_model=PushTestResponse,
)
def send_push_test(
    user_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    _ensure_user(user_id, db)
    if not settings.push_enabled or not settings.vapid_private_key:
        raise HTTPException(
            status_code=503,
            detail="Push notifications are not configured",
        )

    payload = json.dumps(
        {
            "title": "Teste do Ritmo 🔔",
            "body": "Os lembretes em segundo plano estão funcionando.",
            "url": "/settings",
            "tag": f"ritmo-push-test-{user_id}",
        },
        ensure_ascii=False,
    )
    subscriptions = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == user_id,
            PushSubscription.enabled.is_(True),
        )
        .all()
    )
    sent = 0
    failed = 0
    expired = 0
    for subscription in subscriptions:
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
                ttl=60,
                timeout=10,
            )
            sent += 1
        except WebPushException as exc:
            status_code = getattr(exc.response, "status_code", None)
            if status_code in {404, 410}:
                subscription.enabled = False
                expired += 1
            else:
                failed += 1
                logger.warning(
                    "Push test failed for subscription %s with status %s",
                    subscription.id,
                    status_code,
                )
    db.commit()
    return PushTestResponse(sent=sent, failed=failed, expired=expired)
