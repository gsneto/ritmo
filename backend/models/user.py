from datetime import time

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, String
from sqlalchemy import Time as SqlTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    profile_id = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    initials = Column(String(3), nullable=False)
    theme = Column(Enum("light", "dark", name="theme_enum"), default="light")
    briefing_enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    briefing_time = Column(
        SqlTime,
        nullable=False,
        default=lambda: time(7, 30),
        server_default="07:30:00",
    )
    # Argon2id hash. Nullable because profiles created before browser
    # authentication existed have no credential until an operator provisions one.
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    habits = relationship("Habit", back_populates="user", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")
    workouts = relationship("Workout", back_populates="user", cascade="all, delete-orphan")
    workout_sessions = relationship(
        "WorkoutSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    reading_books = relationship(
        "ReadingBook",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    shopping_lists = relationship(
        "ShoppingList",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    sessions = relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
