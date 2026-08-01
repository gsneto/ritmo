from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from schemas.common import ApiSchema, Name100, Name200, OptionalNote, OptionalShortText

# Keep the legacy mojibake value temporarily because older seeded databases can
# contain it. New clients should always send the correctly encoded "Sáb".
WorkoutDay = Literal["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "SÃ¡b", "Dom"]
SessionStatus = Literal["active", "completed"]
IdempotencyKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=8, max_length=100),
]
WeightKg = Annotated[
    Decimal,
    Field(ge=Decimal("0"), le=Decimal("500"), max_digits=5, decimal_places=2),
]
IncrementKg = Annotated[
    Decimal,
    Field(
        ge=Decimal("0.25"),
        le=Decimal("20"),
        max_digits=4,
        decimal_places=2,
    ),
]


class ExerciseCreate(ApiSchema):
    name: Name100
    sets: OptionalShortText | None = None
    reps: OptionalShortText | None = None


class ExerciseResponse(ApiSchema):
    id: int
    name: str
    sets: str | None = None
    reps: str | None = None


class WorkoutCreate(ApiSchema):
    day: WorkoutDay
    title: Name200
    note: OptionalNote | None = None
    exercises: list[ExerciseCreate] = Field(default_factory=list, max_length=100)


class WorkoutUpdate(ApiSchema):
    day: WorkoutDay | None = None
    title: Name200 | None = None
    note: OptionalNote | None = None
    exercises: list[ExerciseCreate] | None = Field(default=None, max_length=100)


class WorkoutResponse(ApiSchema):
    id: int
    user_id: int
    day: WorkoutDay
    title: str
    note: str | None = None
    exercises: list[ExerciseResponse] = Field(default_factory=list)


class WorkoutsUpdateRequest(ApiSchema):
    workouts: list[WorkoutCreate] = Field(max_length=31)


class WorkoutSessionStart(ApiSchema):
    idempotency_key: IdempotencyKey
    rest_seconds: int = Field(default=60, ge=15, le=600)


class WorkoutSetComplete(ApiSchema):
    weight_kg: WeightKg
    reps_completed: int | None = Field(default=None, ge=1, le=1000)


class WorkoutSetResponse(ApiSchema):
    id: int
    set_number: int
    weight_kg: Decimal | None = None
    reps_completed: int | None = None
    completed_at: datetime | None = None


class WorkoutExerciseSetSnapshotResponse(ApiSchema):
    set_number: int
    weight_kg: Decimal
    reps_completed: int | None = None


class WorkoutExerciseEvolutionPointResponse(ApiSchema):
    session_id: int
    completed_at: datetime
    max_weight_kg: Decimal
    total_reps: int
    completed_sets: int
    target_sets: int
    total_volume_kg: Decimal


class WorkoutExerciseProgressResponse(ApiSchema):
    exercise_name: str
    last_session_at: datetime | None = None
    last_weight_kg: Decimal | None = None
    last_reps_completed: int | None = None
    last_completed_sets: int
    last_target_sets: int | None = None
    last_sets: list[WorkoutExerciseSetSnapshotResponse] = Field(default_factory=list)
    personal_record_weight_kg: Decimal | None = None
    personal_record_reps: int | None = None
    personal_record_volume_kg: Decimal
    suggested_weight_kg: Decimal | None = None
    suggestion_action: Literal["start", "increase", "maintain"]
    suggestion_text: str
    rest_seconds: int = Field(ge=15, le=600)
    increment_kg: Decimal
    evolution: list[WorkoutExerciseEvolutionPointResponse] = Field(default_factory=list)


class WorkoutExercisePreferenceUpdate(ApiSchema):
    exercise_name: Name100
    rest_seconds: int = Field(default=60, ge=15, le=600)
    increment_kg: IncrementKg = Decimal("1.00")


class WorkoutSessionExerciseResponse(ApiSchema):
    id: int
    exercise_id: int | None = None
    name: str
    target_sets: int
    planned_reps: str | None = None
    sort_order: int
    sets: list[WorkoutSetResponse] = Field(default_factory=list)
    progress: WorkoutExerciseProgressResponse | None = None


class WorkoutSessionResponse(ApiSchema):
    id: int
    user_id: int
    workout_id: int | None = None
    workout_title: str
    workout_day: str
    status: SessionStatus
    rest_seconds: int
    started_at: datetime
    completed_at: datetime | None = None
    duration_seconds: int | None = None
    total_sets: int
    completed_sets: int
    max_weight_kg: Decimal
    total_volume_kg: Decimal
    exercises: list[WorkoutSessionExerciseResponse] = Field(default_factory=list)


class WorkoutHistoryResponse(ApiSchema):
    total_sessions: int
    total_minutes: int
    completed_sets: int
    total_volume_kg: Decimal
    sessions: list[WorkoutSessionResponse] = Field(default_factory=list)
    exercise_progress: list[WorkoutExerciseProgressResponse] = Field(
        default_factory=list
    )


class WorkoutSetCompletionState(ApiSchema):
    completed: bool
    weight_kg: WeightKg | None = None
    reps_completed: int | None = Field(default=None, ge=1, le=1000)

    @model_validator(mode="after")
    def validate_completion(self):
        if self.completed and self.weight_kg is None:
            raise ValueError("weight_kg is required when completing a set")
        if not self.completed and (
            self.weight_kg is not None or self.reps_completed is not None
        ):
            raise ValueError(
                "weight_kg and reps_completed must be omitted when clearing a set"
            )
        return self
