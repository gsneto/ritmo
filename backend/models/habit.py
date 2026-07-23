from sqlalchemy import Column, Integer, String, Time, Date, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class Habit(Base):
    __tablename__ = "habits"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    time = Column(Time, nullable=False)
    created_at = Column(Date, nullable=False)

    # Relationships
    user = relationship("User", back_populates="habits")
    check_ins = relationship("HabitCheckIn", back_populates="habit", cascade="all, delete-orphan")


class HabitCheckIn(Base):
    __tablename__ = "habit_check_ins"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    habit_id = Column(Integer, ForeignKey("habits.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False, index=True)

    # Relationships
    habit = relationship("Habit", back_populates="check_ins")
