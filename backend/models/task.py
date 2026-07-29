from sqlalchemy import (
    CheckConstraint,
    Column,
    Integer,
    String,
    Date,
    Time,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship
from database import Base


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "recurrence IN ('none', 'daily', 'weekly', 'monthly')",
            name="ck_tasks_recurrence",
        ),
        CheckConstraint(
            "recurrence_interval >= 1 AND recurrence_interval <= 365",
            name="ck_tasks_recurrence_interval",
        ),
        Index("ix_tasks_recurrence_parent", "recurrence_parent_id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    date = Column(Date, nullable=False, index=True)
    time = Column(Time, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    recurrence = Column(String(12), nullable=False, default="none", server_default="none")
    recurrence_interval = Column(Integer, nullable=False, default=1, server_default="1")
    recurrence_parent_id = Column(Integer, nullable=True)
    created_at = Column(Date, nullable=False)

    # Relationships
    user = relationship("User", back_populates="tasks")
