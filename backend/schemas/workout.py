from pydantic import BaseModel
from typing import Optional


class ExerciseBase(BaseModel):
    name: str
    sets: Optional[str] = None
    reps: Optional[str] = None


class ExerciseCreate(ExerciseBase):
    pass


class ExerciseResponse(ExerciseBase):
    id: int

    class Config:
        from_attributes = True


class WorkoutBase(BaseModel):
    day: str
    title: str
    note: Optional[str] = None


class WorkoutCreate(WorkoutBase):
    exercises: list[ExerciseCreate] = []


class WorkoutUpdate(BaseModel):
    day: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None
    exercises: Optional[list[ExerciseCreate]] = None


class WorkoutResponse(WorkoutBase):
    id: int
    user_id: int
    exercises: list[ExerciseResponse] = []

    class Config:
        from_attributes = True


class WorkoutsUpdateRequest(BaseModel):
    workouts: list[WorkoutCreate]
