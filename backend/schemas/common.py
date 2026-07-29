import re
from datetime import date, time
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, PlainSerializer, StringConstraints


class ApiSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


def _validate_iso_date(value):
    if isinstance(value, date) and not hasattr(value, "hour"):
        return value
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is None:
        raise ValueError("date must use YYYY-MM-DD format")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must be a valid calendar date") from exc


def _validate_hhmm(value):
    if isinstance(value, time):
        if value.second or value.microsecond or value.tzinfo is not None:
            raise ValueError("time must use HH:MM format")
        return value
    if not isinstance(value, str) or re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) is None:
        raise ValueError("time must use HH:MM format")
    return time.fromisoformat(value)


IsoDate = Annotated[
    date,
    BeforeValidator(_validate_iso_date),
    PlainSerializer(lambda value: value.isoformat(), return_type=str),
]
HourMinute = Annotated[
    time,
    BeforeValidator(_validate_hhmm),
    PlainSerializer(lambda value: value.strftime("%H:%M"), return_type=str),
]

Name50 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
Name100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Name200 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Initials = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3)]
OptionalShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
OptionalNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
