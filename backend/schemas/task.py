from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field

from schemas.common import ApiSchema, HourMinute, IsoDate, Name200

TaskRecurrence = Literal["none", "daily", "weekly", "monthly"]
RecurrenceInterval = Annotated[int, Field(ge=1, le=365)]


class TaskCreate(ApiSchema):
    name: Name200
    date: IsoDate
    time: HourMinute
    recurrence: TaskRecurrence = "none"
    recurrence_interval: RecurrenceInterval = 1


class TaskUpdate(ApiSchema):
    name: Name200 | None = None
    date: IsoDate | None = None
    time: HourMinute | None = None
    recurrence: TaskRecurrence | None = None
    recurrence_interval: RecurrenceInterval | None = None


class TaskResponse(ApiSchema):
    id: int
    user_id: int
    name: str
    date: IsoDate
    time: HourMinute
    completed_at: datetime | None = None
    recurrence: TaskRecurrence
    recurrence_interval: int
    recurrence_parent_id: int | None = None
    created_at: IsoDate
