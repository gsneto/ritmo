from typing import cast

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.shopping import ShoppingPair


def shopping_household_user_ids(db: Session, user_id: int) -> tuple[int, ...]:
    """Return the profile IDs whose shopping lists are visible to this profile."""
    pair = (
        db.query(ShoppingPair)
        .filter(
            or_(
                ShoppingPair.owner_user_id == user_id,
                ShoppingPair.partner_user_id == user_id,
            )
        )
        .first()
    )
    if pair is None or pair.partner_user_id is None:
        return (user_id,)
    return (
        cast(int, pair.owner_user_id),
        cast(int, pair.partner_user_id),
    )
