from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, StrictBool, field_validator, model_validator

from schemas.common import (
    ApiSchema,
    HourMinute,
    Initials,
    IsoDate,
    Name100,
    Name200,
    OptionalNote,
)
from schemas.habit import Weekday
from schemas.reading import (
    DurationMinutes,
    PageNumber,
    ReadingNoteContent,
    ReadingNotes,
    ReadingSessionSource,
    ReadingStatus,
    TotalPages,
)
from schemas.shopping import (
    MoneyCents,
    Quantity,
    ShoppingCategory,
    ShoppingKind,
)
from schemas.task import RecurrenceInterval, TaskRecurrence
from schemas.workout import IncrementKg, WeightKg, WorkoutDay


class BackupProfile(ApiSchema):
    name: Name100
    initials: Initials
    theme: Literal["light", "dark"]


class BackupHabit(ApiSchema):
    source_id: int = Field(ge=1)
    name: Name200
    time: HourMinute
    active_days: list[Weekday] = Field(min_length=1, max_length=7)
    created_at: IsoDate
    check_ins: list[IsoDate] = Field(default_factory=list, max_length=100_000)

    @field_validator("active_days")
    @classmethod
    def normalize_active_days(cls, value: list[int]) -> list[int]:
        return sorted(set(value))


class BackupTask(ApiSchema):
    source_id: int = Field(ge=1)
    name: Name200
    date: IsoDate
    time: HourMinute
    completed_at: datetime | None = None
    recurrence: TaskRecurrence = "none"
    recurrence_interval: RecurrenceInterval = 1
    recurrence_parent_source_id: int | None = Field(default=None, ge=1)
    created_at: IsoDate


class BackupShoppingItem(ApiSchema):
    source_id: int = Field(ge=1)
    name: Name200
    quantity: Quantity = 1
    checked_at: datetime | None = None
    unit_price_cents: MoneyCents | None = None
    price_cents: MoneyCents | None = None
    created_at: datetime

    @model_validator(mode="after")
    def validate_checked_price_pair(self):
        if (self.checked_at is None) != (self.price_cents is None):
            raise ValueError("checked_at and price_cents must be present together")
        return self


class BackupShoppingList(ApiSchema):
    source_id: int = Field(ge=1)
    ownership: Literal["profile", "shared"] = "profile"
    name: Name200
    kind: ShoppingKind
    category: ShoppingCategory = "other"
    planned_date: IsoDate
    budget_cents: MoneyCents | None = None
    repeat_enabled: StrictBool = False
    next_list_source_id: int | None = Field(default=None, ge=1)
    completed_on: IsoDate | None = None
    completed_at: datetime | None = None
    total_cents: MoneyCents = 0
    revision: int = Field(default=0, ge=0)
    created_at: datetime
    items: list[BackupShoppingItem] = Field(default_factory=list, max_length=20_000)


class BackupShoppingBudget(ApiSchema):
    month: str = Field(pattern=r"^\d{4}-(?:0[1-9]|1[0-2])$")
    budget_cents: MoneyCents
    created_at: datetime
    updated_at: datetime


class BackupExercise(ApiSchema):
    source_id: int = Field(ge=1)
    name: Name100
    sets: str | None = Field(default=None, max_length=20)
    reps: str | None = Field(default=None, max_length=20)


class BackupWorkout(ApiSchema):
    source_id: int = Field(ge=1)
    day: WorkoutDay
    title: Name200
    note: OptionalNote | None = None
    exercises: list[BackupExercise] = Field(default_factory=list, max_length=100)


class BackupWorkoutSet(ApiSchema):
    set_number: int = Field(ge=1, le=20)
    weight_kg: WeightKg | None = None
    reps_completed: int | None = Field(default=None, ge=1, le=1000)
    completed_at: datetime | None = None

    @model_validator(mode="after")
    def validate_completion(self):
        if self.completed_at is None and (
            self.weight_kg is not None or self.reps_completed is not None
        ):
            raise ValueError("an incomplete workout set cannot contain results")
        if self.completed_at is not None and self.weight_kg is None:
            raise ValueError("a completed workout set requires weight_kg")
        return self


class BackupWorkoutSessionExercise(ApiSchema):
    source_exercise_id: int | None = Field(default=None, ge=1)
    name: Name100
    target_sets: int = Field(ge=1, le=20)
    planned_reps: str | None = Field(default=None, max_length=20)
    sort_order: int = Field(ge=0, le=100)
    sets: list[BackupWorkoutSet] = Field(default_factory=list, max_length=20)


class BackupWorkoutSession(ApiSchema):
    source_id: int = Field(ge=1)
    source_workout_id: int | None = Field(default=None, ge=1)
    workout_title: Name200
    workout_day: str = Field(min_length=1, max_length=10)
    status: Literal["active", "completed"]
    rest_seconds: int = Field(ge=15, le=600)
    started_at: datetime
    completed_at: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    revision: int = Field(default=0, ge=0)
    exercises: list[BackupWorkoutSessionExercise] = Field(
        default_factory=list,
        max_length=100,
    )


class BackupWorkoutPreference(ApiSchema):
    exercise_key: str = Field(min_length=1, max_length=140)
    display_name: Name100
    rest_seconds: int = Field(ge=15, le=600)
    increment_kg: IncrementKg = Decimal("1.00")


class BackupReadingSession(ApiSchema):
    session_date: IsoDate
    start_page: PageNumber
    end_page: PageNumber
    duration_minutes: DurationMinutes
    source: ReadingSessionSource = "manual"
    created_at: datetime


class BackupReadingNote(ApiSchema):
    note_date: IsoDate
    page: PageNumber
    content: ReadingNoteContent
    created_at: datetime
    updated_at: datetime


class BackupReadingBook(ApiSchema):
    source_id: int = Field(ge=1)
    title: Name200
    current_page: PageNumber
    total_pages: TotalPages
    notes: ReadingNotes = ""
    status: ReadingStatus
    is_active: StrictBool = False
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    sessions: list[BackupReadingSession] = Field(default_factory=list, max_length=20_000)
    reading_notes: list[BackupReadingNote] = Field(default_factory=list, max_length=20_000)


class RitmoBackup(ApiSchema):
    version: Literal[1, 2] = 2
    app: Literal["Ritmo"] = "Ritmo"
    exported_at: datetime
    profile: BackupProfile
    habits: list[BackupHabit] = Field(default_factory=list, max_length=10_000)
    tasks: list[BackupTask] = Field(default_factory=list, max_length=50_000)
    shopping_lists: list[BackupShoppingList] = Field(
        default_factory=list,
        max_length=10_000,
    )
    shopping_budgets: list[BackupShoppingBudget] = Field(
        default_factory=list,
        max_length=1_200,
    )
    workouts: list[BackupWorkout] = Field(default_factory=list, max_length=366)
    workout_sessions: list[BackupWorkoutSession] = Field(
        default_factory=list,
        max_length=20_000,
    )
    workout_preferences: list[BackupWorkoutPreference] = Field(
        default_factory=list,
        max_length=10_000,
    )
    reading_books: list[BackupReadingBook] = Field(
        default_factory=list,
        max_length=10_000,
    )

    @model_validator(mode="after")
    def validate_backup_links(self):
        def ensure_unique(values: list[int], label: str) -> None:
            if len(values) != len(set(values)):
                raise ValueError(f"duplicate source_id in {label}")

        habit_ids = [item.source_id for item in self.habits]
        task_ids = [item.source_id for item in self.tasks]
        shopping_ids = [item.source_id for item in self.shopping_lists]
        workout_ids = [item.source_id for item in self.workouts]
        book_ids = [item.source_id for item in self.reading_books]
        for values, label in (
            (habit_ids, "habits"),
            (task_ids, "tasks"),
            (shopping_ids, "shopping_lists"),
            (workout_ids, "workouts"),
            (book_ids, "reading_books"),
        ):
            ensure_unique(values, label)

        exercise_ids = [
            exercise.source_id
            for workout in self.workouts
            for exercise in workout.exercises
        ]
        ensure_unique(exercise_ids, "workout exercises")

        item_ids = [
            item.source_id
            for shopping_list in self.shopping_lists
            for item in shopping_list.items
        ]
        ensure_unique(item_ids, "shopping items")

        if sum(book.is_active for book in self.reading_books) > 1:
            raise ValueError("only one reading book can be active")
        if sum(session.status == "active" for session in self.workout_sessions) > 1:
            raise ValueError("only one workout session can be active")

        task_id_set = set(task_ids)
        shopping_id_set = set(shopping_ids)
        workout_id_set = set(workout_ids)
        exercise_id_set = set(exercise_ids)
        if any(
            task.recurrence_parent_source_id is not None
            and task.recurrence_parent_source_id not in task_id_set
            for task in self.tasks
        ):
            raise ValueError("task recurrence parent is missing")
        if any(
            item.next_list_source_id is not None
            and item.next_list_source_id not in shopping_id_set
            for item in self.shopping_lists
        ):
            raise ValueError("next shopping list is missing")
        if any(
            session.source_workout_id is not None
            and session.source_workout_id not in workout_id_set
            for session in self.workout_sessions
        ):
            raise ValueError("workout session template is missing")
        if any(
            exercise.source_exercise_id is not None
            and exercise.source_exercise_id not in exercise_id_set
            for session in self.workout_sessions
            for exercise in session.exercises
        ):
            raise ValueError("workout session exercise template is missing")
        return self


class BackupRestoreResponse(ApiSchema):
    message: str
    restored: dict[str, int]
