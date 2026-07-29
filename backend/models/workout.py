from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


class Workout(Base):
    """Editable weekly workout template."""

    __tablename__ = "workouts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    day = Column(String(10), nullable=False)
    title = Column(String(200), nullable=False)
    note = Column(Text, nullable=True)

    user = relationship("User", back_populates="workouts")
    exercises = relationship(
        "Exercise",
        back_populates="workout",
        cascade="all, delete-orphan",
        order_by="Exercise.id",
    )
    sessions = relationship(
        "WorkoutSession",
        back_populates="workout",
        passive_deletes=True,
    )


class Exercise(Base):
    """Exercise inside an editable weekly template."""

    __tablename__ = "exercises"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    workout_id = Column(
        Integer,
        ForeignKey("workouts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    sets = Column(String(20), nullable=True)
    reps = Column(String(20), nullable=True)

    workout = relationship("Workout", back_populates="exercises")


class WorkoutSession(Base):
    """One guided workout execution.

    Template fields are copied into the session so replacing the weekly plan
    never changes or deletes workout history.
    """

    __tablename__ = "workout_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'completed')",
            name="ck_workout_sessions_status",
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="ck_workout_sessions_duration_nonnegative",
        ),
        CheckConstraint(
            "rest_seconds >= 15 AND rest_seconds <= 600",
            name="ck_workout_sessions_rest_range",
        ),
        CheckConstraint(
            "revision >= 0",
            name="ck_workout_sessions_revision_nonnegative",
        ),
        Index(
            "ix_workout_sessions_user_status_started",
            "user_id",
            "status",
            "started_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workout_id = Column(
        Integer,
        ForeignKey("workouts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    idempotency_key = Column(String(100), nullable=True, unique=True, index=True)
    workout_title = Column(String(200), nullable=False)
    workout_day = Column(String(10), nullable=False)
    status = Column(String(12), nullable=False, default="active")
    rest_seconds = Column(Integer, nullable=False, default=60)
    started_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    duration_seconds = Column(Integer, nullable=True)
    revision = Column(Integer, nullable=False, default=0, server_default="0")

    user = relationship("User", back_populates="workout_sessions")
    workout = relationship("Workout", back_populates="sessions")
    exercises = relationship(
        "WorkoutSessionExercise",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="WorkoutSessionExercise.sort_order",
    )


class WorkoutSessionExercise(Base):
    """Immutable exercise snapshot belonging to a workout session."""

    __tablename__ = "workout_session_exercises"
    __table_args__ = (
        CheckConstraint(
            "target_sets >= 1 AND target_sets <= 20",
            name="ck_workout_session_exercises_target_sets",
        ),
        UniqueConstraint(
            "session_id",
            "sort_order",
            name="uq_workout_session_exercises_order",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_id = Column(
        Integer,
        ForeignKey("workout_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    exercise_id = Column(
        Integer,
        ForeignKey("exercises.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name = Column(String(100), nullable=False)
    target_sets = Column(Integer, nullable=False)
    planned_reps = Column(String(20), nullable=True)
    sort_order = Column(Integer, nullable=False)

    session = relationship("WorkoutSession", back_populates="exercises")
    sets = relationship(
        "WorkoutSetLog",
        back_populates="session_exercise",
        cascade="all, delete-orphan",
        order_by="WorkoutSetLog.set_number",
    )


class WorkoutSetLog(Base):
    """A set completion and the exact dumbbell weight used."""

    __tablename__ = "workout_set_logs"
    __table_args__ = (
        CheckConstraint(
            "set_number >= 1 AND set_number <= 20",
            name="ck_workout_set_logs_number",
        ),
        CheckConstraint(
            "weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 500)",
            name="ck_workout_set_logs_weight",
        ),
        CheckConstraint(
            "reps_completed IS NULL OR "
            "(reps_completed >= 1 AND reps_completed <= 1000)",
            name="ck_workout_set_logs_reps",
        ),
        CheckConstraint(
            "(completed_at IS NULL AND weight_kg IS NULL AND reps_completed IS NULL) OR "
            "(completed_at IS NOT NULL AND weight_kg IS NOT NULL)",
            name="ck_workout_set_logs_completion",
        ),
        UniqueConstraint(
            "session_exercise_id",
            "set_number",
            name="uq_workout_set_logs_exercise_number",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_exercise_id = Column(
        Integer,
        ForeignKey("workout_session_exercises.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    set_number = Column(Integer, nullable=False)
    weight_kg = Column(Numeric(6, 2), nullable=True)
    reps_completed = Column(Integer, nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    session_exercise = relationship(
        "WorkoutSessionExercise",
        back_populates="sets",
    )
