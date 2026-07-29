import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config import Settings, get_settings
from database import get_db
from models.push import PushSubscription
from models.user import User
from schemas.push import (
    PushConfigResponse,
    PushSubscriptionDelete,
    PushSubscriptionResponse,
    PushSubscriptionUpsert,
)
from time_utils import app_now


router = APIRouter(prefix="/api/users", tags=["push"])


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
        subscription.user_id = user_id
        subscription.p256dh = data.keys.p256dh
        subscription.auth = data.keys.auth
        subscription.enabled = True
        subscription.updated_at = now
    db.commit()
    return PushSubscriptionResponse(subscribed=True)


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
