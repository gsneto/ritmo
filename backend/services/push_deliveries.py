from datetime import datetime

from sqlalchemy.orm import Session

from models.push import PushDelivery

WEB_PUSH_SUBSCRIPTION_FAILURE_STATUSES = frozenset({400, 401, 403, 404, 410, 413})


def cancel_pending_push_deliveries(
    db: Session,
    *,
    user_id: int,
    reason: str,
    now: datetime,
    subscription_id: int | None = None,
) -> int:
    query = db.query(PushDelivery).filter(
        PushDelivery.user_id == user_id,
        PushDelivery.status == "pending",
    )
    if subscription_id is not None:
        query = query.filter(PushDelivery.subscription_id == subscription_id)
    return query.update(
        {
            PushDelivery.status: "failed",
            PushDelivery.next_retry_at: None,
            PushDelivery.last_error: reason[:255],
            PushDelivery.updated_at: now,
        },
        synchronize_session=False,
    )
