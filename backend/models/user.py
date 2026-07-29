from sqlalchemy import Column, Integer, String, DateTime, Enum
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
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    habits = relationship("Habit", back_populates="user", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")
    workouts = relationship("Workout", back_populates="user", cascade="all, delete-orphan")
    shopping_lists = relationship(
        "ShoppingList",
        back_populates="user",
        cascade="all, delete-orphan",
    )
