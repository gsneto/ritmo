from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from database import Base


class ShoppingList(Base):
    __tablename__ = "shopping_lists"
    __table_args__ = (
        CheckConstraint("total_cents >= 0", name="ck_shopping_lists_total_nonnegative"),
        CheckConstraint(
            "budget_cents IS NULL OR budget_cents >= 0",
            name="ck_shopping_lists_budget_nonnegative",
        ),
        CheckConstraint("revision >= 0", name="ck_shopping_lists_revision_nonnegative"),
        Index("ix_shopping_lists_user_planned", "user_id", "planned_date"),
        Index("ix_shopping_lists_user_completed", "user_id", "completed_on"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    kind = Column(String(20), nullable=False, default="one_time")
    category = Column(String(24), nullable=False, default="other", server_default="other")
    planned_date = Column(Date, nullable=False, index=True)
    budget_cents = Column(Integer, nullable=True)
    repeat_enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    next_list_id = Column(Integer, nullable=True)
    completed_on = Column(Date, nullable=True, index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    total_cents = Column(Integer, nullable=False, default=0)
    revision = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="shopping_lists")
    items = relationship(
        "ShoppingItem",
        back_populates="shopping_list",
        cascade="all, delete-orphan",
        order_by="ShoppingItem.id",
    )


class ShoppingItem(Base):
    __tablename__ = "shopping_items"
    __table_args__ = (
        CheckConstraint(
            "price_cents IS NULL OR price_cents >= 0",
            name="ck_shopping_items_price_nonnegative",
        ),
        CheckConstraint(
            "unit_price_cents IS NULL OR unit_price_cents >= 0",
            name="ck_shopping_items_unit_price_nonnegative",
        ),
        CheckConstraint(
            "quantity >= 1",
            name="ck_shopping_items_quantity_positive",
        ),
        CheckConstraint(
            "(checked_at IS NULL AND price_cents IS NULL) OR "
            "(checked_at IS NOT NULL AND price_cents IS NOT NULL)",
            name="ck_shopping_items_check_price_pair",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    shopping_list_id = Column(
        Integer,
        ForeignKey("shopping_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(200), nullable=False)
    quantity = Column(Integer, nullable=False, default=1, server_default="1")
    checked_at = Column(DateTime(timezone=True), nullable=True)
    unit_price_cents = Column(Integer, nullable=True)
    price_cents = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    shopping_list = relationship("ShoppingList", back_populates="items")


class ShoppingMonthlyBudget(Base):
    __tablename__ = "shopping_monthly_budgets"
    __table_args__ = (
        CheckConstraint(
            "budget_cents >= 0",
            name="ck_shopping_monthly_budgets_nonnegative",
        ),
        Index(
            "uq_shopping_monthly_budgets_user_month",
            "user_id",
            "month",
            unique=True,
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    month = Column(String(7), nullable=False)
    budget_cents = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)
