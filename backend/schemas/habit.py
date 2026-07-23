from pydantic import BaseModel
from datetime import date
from typing import Optional


class HabitCheckInResponse(BaseModel):
    date: date

    class Config:
        from_attributes = True


class HabitBase(BaseModel):
    name: str
    time: str  # HH:MM format


class HabitCreate(HabitBase):
    pass


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    time: Optional[str] = None


class HabitResponse(HabitBase):
    id: int
    user_id: int
    created_at: date
    check_ins: list[date] = []

    class Config:
        from_attributes = True


class CheckInRequest(BaseModel):
    date: str  # YYYY-MM-DD format
