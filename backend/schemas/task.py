from datetime import datetime

from schemas.common import ApiSchema, HourMinute, IsoDate, Name200


class TaskCreate(ApiSchema):
    name: Name200
    date: IsoDate
    time: HourMinute


class TaskUpdate(ApiSchema):
    name: Name200 | None = None
    date: IsoDate | None = None
    time: HourMinute | None = None


class TaskResponse(ApiSchema):
    id: int
    user_id: int
    name: str
    date: IsoDate
    time: HourMinute
    completed_at: datetime | None = None
    created_at: IsoDate
