from typing import Annotated, Literal

from pydantic import StringConstraints

from schemas.common import ApiSchema, IsoDate

QuestionText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000),
]
AnswerText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=6_000),
]


class AnahiQuestion(ApiSchema):
    """One short, stateless question for the Ritmo assistant."""

    question: QuestionText


class AnahiAnswer(ApiSchema):
    answer: AnswerText
    model: str
    profile_name: str
    as_of: IsoDate
    used_sources: list[
        Literal["habits", "tasks", "reading", "shopping", "workouts"]
    ]
