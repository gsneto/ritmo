from datetime import date

from sqlalchemy import Column, Date, ForeignKey, Integer, String, Time, UniqueConstraint
from sqlalchemy.orm import relationship

from database import Base

DEFAULT_ACTIVE_DAYS = "0,1,2,3,4,5,6"


def decode_active_days(value: str | None) -> set[int]:
    """Return the weekdays (Monday=0) configured for a habit."""
    if not value:
        return set(range(7))
    try:
        days = {int(item) for item in value.split(",") if item != ""}
    except ValueError:
        return set(range(7))
    valid = {day for day in days if 0 <= day <= 6}
    return valid or set(range(7))


def habit_is_scheduled(habit: "Habit", check_date: date) -> bool:
    return check_date.weekday() in decode_active_days(habit.active_days)


class Habit(Base):
    __tablename__ = "habits"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    time = Column(Time, nullable=False)
    active_days = Column(
        String(20),
        nullable=False,
        default=DEFAULT_ACTIVE_DAYS,
        server_default=DEFAULT_ACTIVE_DAYS,
    )
    created_at = Column(Date, nullable=False)

    # Relationships
    user = relationship("User", back_populates="habits")
    check_ins = relationship("HabitCheckIn", back_populates="habit", cascade="all, delete-orphan")


class HabitCheckIn(Base):
    __tablename__ = "habit_check_ins"
    __table_args__ = (
        UniqueConstraint("habit_id", "date", name="uq_habit_check_ins_habit_date"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    habit_id = Column(Integer, ForeignKey("habits.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False, index=True)

    # Relationships
    habit = relationship("Habit", back_populates="check_ins")
