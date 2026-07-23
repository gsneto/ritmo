from pydantic import BaseModel
from datetime import date, time, datetime
from typing import Optional


class TaskBase(BaseModel):
    name: str
    date: str  # YYYY-MM-DD format
    time: str  # HH:MM format


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None


class TaskResponse(BaseModel):
    id: int
    user_id: int
    name: str
    date: date
    time: time
    completed_at: Optional[datetime] = None
    created_at: date

    class Config:
        from_attributes = True
