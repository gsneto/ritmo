from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class UserBase(BaseModel):
    profile_id: str
    name: str
    initials: str


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    name: Optional[str] = None
    initials: Optional[str] = None
    theme: Optional[str] = None


class UserResponse(UserBase):
    id: int
    theme: str
    created_at: datetime

    class Config:
        from_attributes = True


class ThemeUpdate(BaseModel):
    theme: str
