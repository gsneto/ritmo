from typing import Literal

from pydantic import Field

from schemas.common import ApiSchema, Name100, Name200, OptionalNote, OptionalShortText


WorkoutDay = Literal["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]


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
