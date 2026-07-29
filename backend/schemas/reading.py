from datetime import datetime
from typing import Annotated

from pydantic import Field, StrictInt, StringConstraints, model_validator

from schemas.common import ApiSchema, Name200


PageNumber = Annotated[StrictInt, Field(ge=0, le=100_000)]
TotalPages = Annotated[StrictInt, Field(ge=1, le=100_000)]
ReadingNotes = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=10_000),
]


class ReadingBookUpsert(ApiSchema):
    title: Name200
    current_page: PageNumber = 0
    total_pages: TotalPages
    notes: ReadingNotes = ""

    @model_validator(mode="after")
    def validate_page_progress(self):
        if self.current_page > self.total_pages:
            raise ValueError("current_page cannot be greater than total_pages")
        return self


class ReadingBookResponse(ApiSchema):
    id: int
    user_id: int
    title: str
    current_page: int
    total_pages: int
    notes: str
    progress_percent: float
    created_at: datetime
    updated_at: datetime
