import re
import secrets
from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models.shopping import (
    ShoppingItem,
    ShoppingList,
    ShoppingMonthlyBudget,
    ShoppingPair,
)
from models.user import User
from schemas.shopping import (
    CategoryExpenseSummary,
    MonthlyExpenseSummary,
    ShoppingBudgetUpdate,
    ShoppingItemCheck,
    ShoppingItemCreate,
    ShoppingItemResponse,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListResponse,
    ShoppingListUpdate,
    ShoppingMonthlyBudgetResponse,
    ShoppingPriceHistory,
    ShoppingPriceHistoryEntry,
    ShoppingShareCode,
    ShoppingSharePartner,
    ShoppingShareStatus,
)
from time_utils import app_now, app_today

router = APIRouter(prefix="/api", tags=["shopping"])
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _get_user(user_id: int, db: Session) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _get_shopping_pair(user_id: int, db: Session) -> ShoppingPair | None:
    return (
        db.query(ShoppingPair)
        .filter(
            or_(
                ShoppingPair.owner_user_id == user_id,
                ShoppingPair.partner_user_id == user_id,
            )
        )
        .first()
    )


def _shopping_user_ids(user_id: int, db: Session) -> tuple[int, ...]:
    pair = _get_shopping_pair(user_id, db)
    if pair is None or pair.partner_user_id is None:
        return (user_id,)
    return (pair.owner_user_id, pair.partner_user_id)


def _serialize_share_status(
    user_id: int,
    pair: ShoppingPair | None,
    db: Session,
) -> ShoppingShareStatus:
    if pair is None:
        return ShoppingShareStatus(paired=False)
    if pair.partner_user_id is None:
        return ShoppingShareStatus(
            paired=False,
            invite_code=pair.invite_code,
        )

    partner_id = (
        pair.partner_user_id
        if pair.owner_user_id == user_id
        else pair.owner_user_id
    )
    partner = db.get(User, partner_id)
    if partner is None:
        return ShoppingShareStatus(paired=False)
    return ShoppingShareStatus(
        paired=True,
        partner=ShoppingSharePartner(
            id=partner.id,
            name=partner.name,
            initials=partner.initials,
        ),
    )


def _new_invite_code(db: Session) -> str:
    for _ in range(12):
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
        exists = db.query(ShoppingPair.id).filter(
            ShoppingPair.invite_code == code
        ).first()
        if exists is None:
            return code
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not create a shopping invite",
    )


def _add_months(value: date, months: int) -> date:
    target_index = value.year * 12 + value.month - 1 + months
    target_year, zero_based_month = divmod(target_index, 12)
    target_month = zero_based_month + 1
    target_day = min(
        value.day,
        monthrange(target_year, target_month)[1],
    )
    return date(target_year, target_month, target_day)


def _next_planned_date(shopping_list: ShoppingList) -> date:
    if shopping_list.kind == "weekly":
        return date.fromordinal(shopping_list.planned_date.toordinal() + 7)
    return _add_months(shopping_list.planned_date, 1)


def _get_shopping_list(list_id: int, db: Session) -> ShoppingList:
    shopping_list = (
        db.query(ShoppingList)
        .options(selectinload(ShoppingList.items))
        .filter(ShoppingList.id == list_id)
        .first()
    )
    if shopping_list is None:
        raise HTTPException(status_code=404, detail="Shopping list not found")
    return shopping_list


def _get_shopping_item(item_id: int, db: Session) -> ShoppingItem:
    item = (
        db.query(ShoppingItem)
        .options(selectinload(ShoppingItem.shopping_list))
        .filter(ShoppingItem.id == item_id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Shopping item not found")
    return item


def _ensure_editable(shopping_list: ShoppingList) -> None:
    if shopping_list.completed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Completed shopping lists cannot be changed",
        )


def _claim_shopping_list(list_id: int, db: Session) -> ShoppingList:
    """Serialize every mutation through a write lock on the parent list."""
    result = db.execute(
        update(ShoppingList)
        .where(ShoppingList.id == list_id)
        .values(revision=ShoppingList.revision + 1)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Shopping list not found")
    return _get_shopping_list(list_id, db)


def _claim_shopping_item(item_id: int, db: Session) -> ShoppingItem:
    """Lock an item's parent list before reading or changing the item."""
    parent_list_id = (
        select(ShoppingItem.shopping_list_id)
        .where(ShoppingItem.id == item_id)
        .scalar_subquery()
    )
    result = db.execute(
        update(ShoppingList)
        .where(ShoppingList.id == parent_list_id)
        .values(revision=ShoppingList.revision + 1)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Shopping item not found")
    return _get_shopping_item(item_id, db)


def _validate_month(month: str | None) -> tuple[str, date, date]:
    selected_month = month or app_today().strftime("%Y-%m")
    if re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", selected_month) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must use YYYY-MM format",
        )
    try:
        first_day = date.fromisoformat(f"{selected_month}-01")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must use a valid calendar year and month",
        ) from exc
    last_day = date(
        first_day.year,
        first_day.month,
        monthrange(first_day.year, first_day.month)[1],
    )
    return selected_month, first_day, last_day


def _create_next_shopping_list(
    shopping_list: ShoppingList,
    db: Session,
) -> ShoppingList:
    if shopping_list.next_list_id is not None:
        existing = db.get(ShoppingList, shopping_list.next_list_id)
        if existing is not None:
            return existing

    next_list = ShoppingList(
        user_id=shopping_list.user_id,
        name=shopping_list.name,
        kind=shopping_list.kind,
        category=shopping_list.category,
        planned_date=_next_planned_date(shopping_list),
        budget_cents=shopping_list.budget_cents,
        repeat_enabled=True,
        created_at=app_now(),
    )
    db.add(next_list)
    db.flush()
    for source_item in shopping_list.items:
        db.add(
            ShoppingItem(
                shopping_list_id=next_list.id,
                name=source_item.name,
                quantity=source_item.quantity,
                created_at=app_now(),
            )
        )
    shopping_list.next_list_id = next_list.id
    return next_list


@router.get(
    "/users/{user_id}/shopping-share",
    response_model=ShoppingShareStatus,
)
def get_shopping_share_status(
    user_id: int,
    db: Session = Depends(get_db),
):
    _get_user(user_id, db)
    return _serialize_share_status(user_id, _get_shopping_pair(user_id, db), db)


@router.post(
    "/users/{user_id}/shopping-share/invite",
    response_model=ShoppingShareStatus,
)
def create_shopping_share_invite(
    user_id: int,
    db: Session = Depends(get_db),
):
    _get_user(user_id, db)
    existing = _get_shopping_pair(user_id, db)
    if existing is not None:
        return _serialize_share_status(user_id, existing, db)

    pair = ShoppingPair(
        owner_user_id=user_id,
        invite_code=_new_invite_code(db),
        created_at=app_now(),
    )
    db.add(pair)
    try:
        db.commit()
        db.refresh(pair)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This profile already has a shopping invite",
        ) from exc
    return _serialize_share_status(user_id, pair, db)


@router.post(
    "/users/{user_id}/shopping-share/redeem",
    response_model=ShoppingShareStatus,
)
def redeem_shopping_share_invite(
    user_id: int,
    data: ShoppingShareCode,
    db: Session = Depends(get_db),
):
    _get_user(user_id, db)
    if _get_shopping_pair(user_id, db) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This profile already has a shopping share",
        )

    pair = db.query(ShoppingPair).filter(
        ShoppingPair.invite_code == data.code,
        ShoppingPair.partner_user_id.is_(None),
    ).first()
    if pair is None:
        raise HTTPException(status_code=404, detail="Shopping invite not found")
    if pair.owner_user_id == user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A profile cannot redeem its own invite",
        )

    try:
        claimed = db.execute(
            update(ShoppingPair)
            .where(
                ShoppingPair.id == pair.id,
                ShoppingPair.partner_user_id.is_(None),
            )
            .values(partner_user_id=user_id, paired_at=app_now())
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This shopping invite is no longer available",
            )
        db.commit()
        db.refresh(pair)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This shopping invite is no longer available",
        ) from exc
    return _serialize_share_status(user_id, pair, db)


@router.delete(
    "/users/{user_id}/shopping-share",
    response_model=ShoppingShareStatus,
)
def delete_shopping_share(
    user_id: int,
    db: Session = Depends(get_db),
):
    _get_user(user_id, db)
    pair = _get_shopping_pair(user_id, db)
    if pair is not None:
        db.delete(pair)
        db.commit()
    return ShoppingShareStatus(paired=False)


@router.get(
    "/users/{user_id}/shopping-lists",
    response_model=list[ShoppingListResponse],
)
def list_shopping_lists(
    user_id: int,
    completed: bool | None = Query(default=None),
    db: Session = Depends(get_db),
):
    visible_user_ids = _shopping_user_ids(user_id, db)
    query = (
        db.query(ShoppingList)
        .options(selectinload(ShoppingList.items))
        .filter(ShoppingList.user_id.in_(visible_user_ids))
    )
    if completed is True:
        query = query.filter(ShoppingList.completed_at.is_not(None))
        return query.order_by(ShoppingList.completed_at.desc()).all()
    if completed is False:
        query = query.filter(ShoppingList.completed_at.is_(None))
    return query.order_by(ShoppingList.planned_date, ShoppingList.id).all()


@router.post(
    "/users/{user_id}/shopping-lists",
    response_model=ShoppingListResponse,
)
def create_shopping_list(
    user_id: int,
    data: ShoppingListCreate,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    shopping_list = ShoppingList(
        user_id=user_id,
        name=data.name,
        kind=data.kind,
        category=data.category,
        planned_date=data.planned_date,
        budget_cents=data.budget_cents,
        repeat_enabled=data.repeat_enabled,
        created_at=app_now(),
    )
    db.add(shopping_list)
    db.commit()
    db.refresh(shopping_list)
    return shopping_list


@router.get("/shopping-lists/{list_id}", response_model=ShoppingListResponse)
def get_shopping_list(list_id: int, db: Session = Depends(get_db)):
    return _get_shopping_list(list_id, db)


@router.put("/shopping-lists/{list_id}", response_model=ShoppingListResponse)
def update_shopping_list(
    list_id: int,
    data: ShoppingListUpdate,
    db: Session = Depends(get_db),
):
    shopping_list = _claim_shopping_list(list_id, db)
    _ensure_editable(shopping_list)

    if data.name is not None:
        shopping_list.name = data.name
    if data.kind is not None:
        shopping_list.kind = data.kind
    if data.category is not None:
        shopping_list.category = data.category
    if data.planned_date is not None:
        shopping_list.planned_date = data.planned_date
    if "budget_cents" in data.model_fields_set:
        shopping_list.budget_cents = data.budget_cents
    if data.repeat_enabled is not None:
        shopping_list.repeat_enabled = data.repeat_enabled
    if shopping_list.repeat_enabled and shopping_list.kind == "one_time":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="repeat_enabled requires a weekly or monthly list",
        )

    db.commit()
    db.refresh(shopping_list)
    return shopping_list


@router.delete("/shopping-lists/{list_id}")
def delete_shopping_list(list_id: int, db: Session = Depends(get_db)):
    shopping_list = _claim_shopping_list(list_id, db)
    _ensure_editable(shopping_list)
    db.delete(shopping_list)
    db.commit()
    return {"message": "Shopping list deleted"}


@router.post(
    "/shopping-lists/{list_id}/items",
    response_model=ShoppingItemResponse,
)
def create_shopping_item(
    list_id: int,
    data: ShoppingItemCreate,
    db: Session = Depends(get_db),
):
    shopping_list = _claim_shopping_list(list_id, db)
    _ensure_editable(shopping_list)

    item = ShoppingItem(
        shopping_list_id=shopping_list.id,
        name=data.name,
        quantity=data.quantity,
        created_at=app_now(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/shopping-items/{item_id}", response_model=ShoppingItemResponse)
def update_shopping_item(
    item_id: int,
    data: ShoppingItemUpdate,
    db: Session = Depends(get_db),
):
    item = _claim_shopping_item(item_id, db)
    _ensure_editable(item.shopping_list)
    if data.name is not None:
        item.name = data.name
    if data.quantity is not None:
        item.quantity = data.quantity
        if item.checked_at is not None and item.unit_price_cents is not None:
            item.price_cents = item.quantity * item.unit_price_cents
    db.commit()
    db.refresh(item)
    return item


@router.put(
    "/shopping-items/{item_id}/check",
    response_model=ShoppingItemResponse,
)
def check_shopping_item(
    item_id: int,
    data: ShoppingItemCheck,
    db: Session = Depends(get_db),
):
    item = _claim_shopping_item(item_id, db)
    _ensure_editable(item.shopping_list)

    if data.checked:
        if data.quantity is not None:
            item.quantity = data.quantity
        if data.unit_price_cents is not None:
            item.unit_price_cents = data.unit_price_cents
            item.price_cents = item.quantity * data.unit_price_cents
        else:
            # Backwards compatibility: the old client sent only the item total.
            item.price_cents = data.price_cents
            item.unit_price_cents = (
                data.price_cents // item.quantity
                if data.price_cents is not None
                and data.price_cents % item.quantity == 0
                else data.price_cents
            )
        item.checked_at = app_now()
    else:
        item.checked_at = None
        item.unit_price_cents = None
        item.price_cents = None

    db.commit()
    db.refresh(item)
    return item


@router.delete("/shopping-items/{item_id}")
def delete_shopping_item(item_id: int, db: Session = Depends(get_db)):
    item = _claim_shopping_item(item_id, db)
    _ensure_editable(item.shopping_list)
    db.delete(item)
    db.commit()
    return {"message": "Shopping item deleted"}


@router.post(
    "/shopping-lists/{list_id}/finish",
    response_model=ShoppingListResponse,
)
def finish_shopping_list(list_id: int, db: Session = Depends(get_db)):
    shopping_list = _claim_shopping_list(list_id, db)
    if shopping_list.completed_at is not None:
        if (
            shopping_list.repeat_enabled
            and shopping_list.kind in {"weekly", "monthly"}
            and (
                shopping_list.next_list_id is None
                or db.get(ShoppingList, shopping_list.next_list_id) is None
            )
        ):
            _create_next_shopping_list(shopping_list, db)
        db.commit()
        db.refresh(shopping_list)
        return shopping_list

    purchased_items = [
        item for item in shopping_list.items
        if item.checked_at is not None
    ]
    if not purchased_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Check at least one item before finishing the purchase",
        )
    if any(item.price_cents is None for item in purchased_items):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Every checked item must have a price",
        )

    shopping_list.total_cents = sum(
        item.price_cents or 0
        for item in purchased_items
    )
    shopping_list.completed_on = app_today()
    shopping_list.completed_at = app_now()
    if (
        shopping_list.repeat_enabled
        and shopping_list.kind in {"weekly", "monthly"}
    ):
        _create_next_shopping_list(shopping_list, db)
    db.commit()
    db.refresh(shopping_list)
    return shopping_list


@router.post(
    "/shopping-lists/{list_id}/reopen",
    response_model=ShoppingListResponse,
)
def reopen_shopping_list(list_id: int, db: Session = Depends(get_db)):
    shopping_list = _claim_shopping_list(list_id, db)
    if shopping_list.completed_at is None:
        db.commit()
        db.refresh(shopping_list)
        return shopping_list

    shopping_list.completed_on = None
    shopping_list.completed_at = None
    shopping_list.total_cents = 0
    db.commit()
    db.refresh(shopping_list)
    return shopping_list


@router.get(
    "/users/{user_id}/shopping-history",
    response_model=MonthlyExpenseSummary,
)
def get_monthly_shopping_history(
    user_id: int,
    month: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    selected_month, first_day, last_day = _validate_month(month)
    user_exists = db.query(User.id).filter(User.id == user_id).first()
    if user_exists is None:
        raise HTTPException(status_code=404, detail="User not found")
    visible_user_ids = _shopping_user_ids(user_id, db)

    completed_lists = (
        db.query(ShoppingList)
        .options(selectinload(ShoppingList.items))
        .filter(
            ShoppingList.user_id.in_(visible_user_ids),
            ShoppingList.completed_on >= first_day,
            ShoppingList.completed_on <= last_day,
        )
        .order_by(ShoppingList.completed_on.desc(), ShoppingList.id.desc())
        .all()
    )
    total_cents = sum(item.total_cents for item in completed_lists)
    purchase_count = len(completed_lists)
    monthly_budget = (
        db.query(ShoppingMonthlyBudget)
        .filter(
            ShoppingMonthlyBudget.user_id == user_id,
            ShoppingMonthlyBudget.month == selected_month,
        )
        .first()
    )
    planned_lists_cents = (
        db.query(func.coalesce(func.sum(ShoppingList.budget_cents), 0))
        .filter(
            ShoppingList.user_id.in_(visible_user_ids),
            ShoppingList.planned_date >= first_day,
            ShoppingList.planned_date <= last_day,
        )
        .scalar()
        or 0
    )
    budget_cents = monthly_budget.budget_cents if monthly_budget else 0
    planned_cents = budget_cents or planned_lists_cents

    previous_anchor = _add_months(first_day, -1)
    previous_first = previous_anchor.replace(day=1)
    previous_last = previous_anchor.replace(
        day=monthrange(previous_anchor.year, previous_anchor.month)[1],
    )
    previous_month_total_cents = (
        db.query(func.coalesce(func.sum(ShoppingList.total_cents), 0))
        .filter(
            ShoppingList.user_id.in_(visible_user_ids),
            ShoppingList.completed_on >= previous_first,
            ShoppingList.completed_on <= previous_last,
        )
        .scalar()
        or 0
    )
    change_cents = total_cents - previous_month_total_cents
    change_percent = (
        round((change_cents / previous_month_total_cents) * 100, 1)
        if previous_month_total_cents
        else None
    )

    category_totals_map: dict[str, int] = {}
    for shopping_list in completed_lists:
        category_totals_map[shopping_list.category] = (
            category_totals_map.get(shopping_list.category, 0)
            + shopping_list.total_cents
        )

    return MonthlyExpenseSummary(
        month=selected_month,
        total_cents=total_cents,
        purchase_count=purchase_count,
        average_cents=total_cents // purchase_count if purchase_count else 0,
        budget_cents=budget_cents,
        planned_lists_cents=planned_lists_cents,
        planned_cents=planned_cents,
        balance_cents=planned_cents - total_cents,
        previous_month_total_cents=previous_month_total_cents,
        change_cents=change_cents,
        change_percent=change_percent,
        category_totals=[
            CategoryExpenseSummary(category=category, total_cents=value)
            for category, value in sorted(
                category_totals_map.items(),
                key=lambda item: item[1],
                reverse=True,
            )
        ],
        lists=completed_lists,
    )


@router.put(
    "/users/{user_id}/shopping-budgets/{month}",
    response_model=ShoppingMonthlyBudgetResponse,
)
def set_monthly_shopping_budget(
    user_id: int,
    month: str,
    data: ShoppingBudgetUpdate,
    db: Session = Depends(get_db),
):
    selected_month, _, _ = _validate_month(month)
    user_exists = db.query(User.id).filter(User.id == user_id).first()
    if user_exists is None:
        raise HTTPException(status_code=404, detail="User not found")

    budget = (
        db.query(ShoppingMonthlyBudget)
        .filter(
            ShoppingMonthlyBudget.user_id == user_id,
            ShoppingMonthlyBudget.month == selected_month,
        )
        .first()
    )
    now = app_now()
    if budget is None:
        budget = ShoppingMonthlyBudget(
            user_id=user_id,
            month=selected_month,
            budget_cents=data.budget_cents,
            created_at=now,
            updated_at=now,
        )
        db.add(budget)
    else:
        budget.budget_cents = data.budget_cents
        budget.updated_at = now

    db.commit()
    return ShoppingMonthlyBudgetResponse(
        month=selected_month,
        budget_cents=budget.budget_cents,
    )


@router.get(
    "/users/{user_id}/shopping-price-history",
    response_model=ShoppingPriceHistory,
)
def get_shopping_price_history(
    user_id: int,
    item_name: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=12, ge=1, le=100),
    db: Session = Depends(get_db),
):
    normalized_name = item_name.strip()
    if not normalized_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="item_name cannot be blank",
        )
    user_exists = db.query(User.id).filter(User.id == user_id).first()
    if user_exists is None:
        raise HTTPException(status_code=404, detail="User not found")
    visible_user_ids = _shopping_user_ids(user_id, db)

    rows = (
        db.query(ShoppingItem, ShoppingList)
        .join(ShoppingList, ShoppingList.id == ShoppingItem.shopping_list_id)
        .filter(
            ShoppingList.user_id.in_(visible_user_ids),
            ShoppingList.completed_on.is_not(None),
            ShoppingItem.checked_at.is_not(None),
            func.lower(func.trim(ShoppingItem.name)) == normalized_name.lower(),
        )
        .order_by(
            ShoppingList.completed_on.desc(),
            ShoppingItem.id.desc(),
        )
        .limit(limit)
        .all()
    )
    return ShoppingPriceHistory(
        item_name=normalized_name,
        entries=[
            ShoppingPriceHistoryEntry(
                item_id=item.id,
                list_id=shopping_list.id,
                list_name=shopping_list.name,
                item_name=item.name,
                quantity=item.quantity,
                unit_price_cents=(
                    item.unit_price_cents
                    if item.unit_price_cents is not None
                    else (item.price_cents or 0) // max(item.quantity, 1)
                ),
                total_cents=item.price_cents or 0,
                purchased_on=shopping_list.completed_on,
            )
            for item, shopping_list in rows
        ],
    )
