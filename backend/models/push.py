from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from database import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        UniqueConstraint(
            "endpoint_hash",
            name="uq_push_subscriptions_endpoint_hash",
        ),
        Index("ix_push_subscriptions_user_enabled", "user_id", "enabled"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    endpoint = Column(Text, nullable=False)
    endpoint_hash = Column(String(64), nullable=False)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class PushDelivery(Base):
    __tablename__ = "push_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "subscription_id",
            "reminder_key",
            name="uq_push_deliveries_subscription_reminder",
        ),
        Index("ix_push_deliveries_created", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    subscription_id = Column(
        Integer,
        ForeignKey("push_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reminder_key = Column(String(180), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
