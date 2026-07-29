from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StrictInt, model_validator

from schemas.common import ApiSchema, IsoDate, Name200


ShoppingKind = Literal["monthly", "weekly", "one_time"]
MoneyCents = Annotated[StrictInt, Field(ge=0, le=100_000_000)]


class ShoppingListCreate(ApiSchema):
    name: Name200
    kind: ShoppingKind = "one_time"
    planned_date: IsoDate


class ShoppingListUpdate(ApiSchema):
    name: Name200 | None = None
    kind: ShoppingKind | None = None
    planned_date: IsoDate | None = None


class ShoppingItemCreate(ApiSchema):
    name: Name200


class ShoppingItemUpdate(ApiSchema):
    name: Name200


class ShoppingItemCheck(ApiSchema):
    checked: bool
    price_cents: MoneyCents | None = None

    @model_validator(mode="after")
    def validate_price_for_state(self):
        if self.checked and self.price_cents is None:
            raise ValueError("price_cents is required when checking an item")
        if not self.checked and self.price_cents is not None:
            raise ValueError("price_cents must be omitted when unchecking an item")
        return self


class ShoppingItemResponse(ApiSchema):
    id: int
    shopping_list_id: int
    name: str
    checked_at: datetime | None = None
    price_cents: int | None = None
    created_at: datetime


class ShoppingListResponse(ApiSchema):
    id: int
    user_id: int
    name: str
    kind: ShoppingKind
    planned_date: IsoDate
    completed_on: IsoDate | None = None
    completed_at: datetime | None = None
    total_cents: int
    created_at: datetime
    items: list[ShoppingItemResponse] = Field(default_factory=list)


class MonthlyExpenseSummary(ApiSchema):
    month: str
    total_cents: int
    purchase_count: int
    average_cents: int
    lists: list[ShoppingListResponse] = Field(default_factory=list)
