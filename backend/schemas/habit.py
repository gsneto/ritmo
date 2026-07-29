from datetime import date
from typing import Annotated

from pydantic import Field, field_validator

from schemas.common import ApiSchema, HourMinute, IsoDate, Name200

Weekday = Annotated[int, Field(ge=0, le=6)]


class HabitCreate(ApiSchema):
    name: Name200
    time: HourMinute
    active_days: list[Weekday] = Field(
        default_factory=lambda: list(range(7)),
        min_length=1,
        max_length=7,
    )

    @field_validator("active_days")
    @classmethod
    def normalize_active_days(cls, value: list[int]) -> list[int]:
        return sorted(set(value))


class HabitUpdate(ApiSchema):
    name: Name200 | None = None
    time: HourMinute | None = None
    active_days: list[Weekday] | None = Field(default=None, min_length=1, max_length=7)

    @field_validator("active_days")
    @classmethod
    def normalize_active_days(cls, value: list[int] | None) -> list[int] | None:
        return sorted(set(value)) if value is not None else None


class HabitResponse(ApiSchema):
    id: int
    user_id: int
    name: str
    time: str
    active_days: list[int]
    created_at: date
    check_ins: list[date] = Field(default_factory=list)


class CheckInRequest(ApiSchema):
    date: IsoDate
