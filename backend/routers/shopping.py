import re
from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models.shopping import ShoppingItem, ShoppingList
from models.user import User
from schemas.shopping import (
    MonthlyExpenseSummary,
    ShoppingItemCheck,
    ShoppingItemCreate,
    ShoppingItemResponse,
    ShoppingItemUpdate,
    ShoppingListCreate,
    ShoppingListResponse,
    ShoppingListUpdate,
)
from time_utils import app_now, app_today


router = APIRouter(prefix="/api", tags=["shopping"])


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


@router.get(
    "/users/{user_id}/shopping-lists",
    response_model=list[ShoppingListResponse],
)
def list_shopping_lists(
    user_id: int,
    completed: bool | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = (
        db.query(ShoppingList)
        .options(selectinload(ShoppingList.items))
        .filter(ShoppingList.user_id == user_id)
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
        planned_date=data.planned_date,
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
    if data.planned_date is not None:
        shopping_list.planned_date = data.planned_date

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
    item.name = data.name
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
        item.checked_at = app_now()
        item.price_cents = data.price_cents
    else:
        item.checked_at = None
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

    completed_lists = (
        db.query(ShoppingList)
        .options(selectinload(ShoppingList.items))
        .filter(
            ShoppingList.user_id == user_id,
            ShoppingList.completed_on >= first_day,
            ShoppingList.completed_on <= last_day,
        )
        .order_by(ShoppingList.completed_on.desc(), ShoppingList.id.desc())
        .all()
    )
    total_cents = sum(item.total_cents for item in completed_lists)
    purchase_count = len(completed_lists)

    return MonthlyExpenseSummary(
        month=selected_month,
        total_cents=total_cents,
        purchase_count=purchase_count,
        average_cents=total_cents // purchase_count if purchase_count else 0,
        lists=completed_lists,
    )
