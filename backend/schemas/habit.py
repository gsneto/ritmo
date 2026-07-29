from datetime import date

from pydantic import Field

from schemas.common import ApiSchema, HourMinute, IsoDate, Name200


class HabitCreate(ApiSchema):
    name: Name200
    time: HourMinute


class HabitUpdate(ApiSchema):
    name: Name200 | None = None
    time: HourMinute | None = None


class HabitResponse(ApiSchema):
    id: int
    user_id: int
    name: str
    time: str
    created_at: date
    check_ins: list[date] = Field(default_factory=list)


class CheckInRequest(ApiSchema):
    date: IsoDate
