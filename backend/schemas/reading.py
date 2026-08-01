from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, StringConstraints, model_validator

from schemas.common import ApiSchema, IsoDate, Name200

ReadingStatus = Literal["quero_ler", "lendo", "concluido"]
ReadingSessionSource = Literal["manual", "focus"]
PageNumber = Annotated[StrictInt, Field(ge=0, le=100_000)]
TotalPages = Annotated[StrictInt, Field(ge=1, le=100_000)]
DurationMinutes = Annotated[StrictInt, Field(ge=1, le=1_440)]
ReadingNotes = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=10_000),
]
ReadingNoteContent = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=5_000),
]


class ReadingBookUpsert(ApiSchema):
    """Compatibility payload for the original one-active-book endpoint."""

    title: Name200
    current_page: PageNumber = 0
    total_pages: TotalPages
    notes: ReadingNotes = ""

    @model_validator(mode="after")
    def validate_page_progress(self):
        if self.current_page > self.total_pages:
            raise ValueError("current_page cannot be greater than total_pages")
        return self


class ReadingBookCreate(ReadingBookUpsert):
    status: ReadingStatus = "quero_ler"
    is_active: StrictBool = False

    @model_validator(mode="after")
    def validate_status_progress(self):
        if self.status == "concluido" and self.current_page != self.total_pages:
            raise ValueError("a completed book must be on its final page")
        return self


class ReadingBookUpdate(ApiSchema):
    title: Name200 | None = None
    current_page: PageNumber | None = None
    total_pages: TotalPages | None = None
    notes: ReadingNotes | None = None
    status: ReadingStatus | None = None
    is_active: StrictBool | None = None


class ReadingBookResponse(ApiSchema):
    id: int
    user_id: int
    title: str
    current_page: int
    total_pages: int
    notes: str
    status: ReadingStatus
    is_active: bool
    progress_percent: float
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ReadingSessionCreate(ApiSchema):
    session_date: IsoDate
    start_page: PageNumber
    end_page: PageNumber
    duration_minutes: DurationMinutes
    source: ReadingSessionSource = "manual"

    @model_validator(mode="after")
    def validate_page_order(self):
        if self.end_page < self.start_page:
            raise ValueError("end_page cannot be lower than start_page")
        return self


class ReadingSessionResponse(ApiSchema):
    id: int
    book_id: int
    book_title: str
    session_date: IsoDate
    start_page: int
    end_page: int
    pages_read: int
    duration_minutes: int
    source: ReadingSessionSource
    created_at: datetime


class ReadingNoteCreate(ApiSchema):
    note_date: IsoDate
    page: PageNumber
    content: ReadingNoteContent


class ReadingNoteResponse(ApiSchema):
    id: int
    book_id: int
    note_date: IsoDate
    page: int
    content: str
    created_at: datetime
    updated_at: datetime


class ReadingWeekResponse(ApiSchema):
    week_start: IsoDate
    week_end: IsoDate
    pages_read: int
    duration_minutes: int
    session_count: int


class ReadingSummaryResponse(ApiSchema):
    pages_this_week: int
    duration_this_week: int
    total_sessions: int
    recent_sessions: list[ReadingSessionResponse]
    weeks: list[ReadingWeekResponse]
