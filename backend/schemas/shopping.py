from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, field_validator, model_validator

from schemas.common import ApiSchema, IsoDate, Name200

ShoppingKind = Literal["monthly", "weekly", "one_time"]
ShoppingCategory = Literal[
    "groceries",
    "child",
    "home",
    "personal",
    "health",
    "transport",
    "other",
]
MoneyCents = Annotated[StrictInt, Field(ge=0, le=100_000_000)]
Quantity = Annotated[StrictInt, Field(ge=1, le=999)]


class ShoppingListCreate(ApiSchema):
    name: Name200
    kind: ShoppingKind = "one_time"
    category: ShoppingCategory = "other"
    planned_date: IsoDate
    budget_cents: MoneyCents | None = None
    repeat_enabled: StrictBool = False

    @model_validator(mode="after")
    def validate_repeat_kind(self):
        if self.repeat_enabled and self.kind == "one_time":
            raise ValueError("repeat_enabled requires a weekly or monthly list")
        return self


class ShoppingListUpdate(ApiSchema):
    name: Name200 | None = None
    kind: ShoppingKind | None = None
    category: ShoppingCategory | None = None
    planned_date: IsoDate | None = None
    budget_cents: MoneyCents | None = None
    repeat_enabled: StrictBool | None = None


class ShoppingItemCreate(ApiSchema):
    name: Name200
    quantity: Quantity = 1


class ShoppingItemUpdate(ApiSchema):
    name: Name200 | None = None
    quantity: Quantity | None = None


class ShoppingItemCheck(ApiSchema):
    checked: bool
    quantity: Quantity | None = None
    unit_price_cents: MoneyCents | None = None
    price_cents: MoneyCents | None = None

    @model_validator(mode="after")
    def validate_price_for_state(self):
        if self.checked and self.unit_price_cents is None and self.price_cents is None:
            raise ValueError(
                "unit_price_cents or price_cents is required when checking an item"
            )
        if not self.checked and (
            self.unit_price_cents is not None
            or self.price_cents is not None
            or self.quantity is not None
        ):
            raise ValueError(
                "price and quantity changes must be omitted when unchecking an item"
            )
        return self


class ShoppingItemResponse(ApiSchema):
    id: int
    shopping_list_id: int
    name: str
    quantity: int
    checked_at: datetime | None = None
    unit_price_cents: int | None = None
    price_cents: int | None = None
    created_at: datetime


class ShoppingListResponse(ApiSchema):
    id: int
    user_id: int
    name: str
    kind: ShoppingKind
    category: ShoppingCategory
    planned_date: IsoDate
    budget_cents: int | None = None
    repeat_enabled: bool
    next_list_id: int | None = None
    completed_on: IsoDate | None = None
    completed_at: datetime | None = None
    total_cents: int
    created_at: datetime
    items: list[ShoppingItemResponse] = Field(default_factory=list)


class ShoppingBudgetUpdate(ApiSchema):
    budget_cents: MoneyCents


class ShoppingMonthlyBudgetResponse(ApiSchema):
    month: str
    budget_cents: int


class CategoryExpenseSummary(ApiSchema):
    category: ShoppingCategory
    total_cents: int


class MonthlyExpenseSummary(ApiSchema):
    month: str
    total_cents: int
    purchase_count: int
    average_cents: int
    budget_cents: int
    planned_lists_cents: int
    planned_cents: int
    balance_cents: int
    previous_month_total_cents: int
    change_cents: int
    change_percent: float | None = None
    category_totals: list[CategoryExpenseSummary] = Field(default_factory=list)
    lists: list[ShoppingListResponse] = Field(default_factory=list)


class ShoppingPriceHistoryEntry(ApiSchema):
    item_id: int
    list_id: int
    list_name: str
    item_name: str
    quantity: int
    unit_price_cents: int
    total_cents: int
    purchased_on: IsoDate


class ShoppingPriceHistory(ApiSchema):
    item_name: str
    entries: list[ShoppingPriceHistoryEntry] = Field(default_factory=list)


class ShoppingShareCode(ApiSchema):
    code: str = Field(min_length=8, max_length=9, pattern=r"^[A-Z2-9-]+$")

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip().upper().replace("-", "")


class ShoppingSharePartner(ApiSchema):
    id: int
    name: str
    initials: str


class ShoppingShareStatus(ApiSchema):
    paired: bool
    invite_code: str | None = None
    partner: ShoppingSharePartner | None = None
