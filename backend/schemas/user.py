from datetime import datetime
from typing import Literal

from schemas.common import ApiSchema, Initials, Name50, Name100

Theme = Literal["light", "dark"]


class UserCreate(ApiSchema):
    profile_id: Name50
    name: Name100
    initials: Initials


class UserUpdate(ApiSchema):
    name: Name100 | None = None
    initials: Initials | None = None
    theme: Theme | None = None


class UserResponse(ApiSchema):
    id: int
    profile_id: str
    name: str
    initials: str
    theme: Theme
    created_at: datetime


class ThemeUpdate(ApiSchema):
    theme: Theme
