from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.reading import ReadingBook
from models.user import User
from schemas.reading import ReadingBookResponse, ReadingBookUpsert
from time_utils import app_now


router = APIRouter(prefix="/api", tags=["reading"])


def _ensure_user(user_id: int, db: Session) -> None:
    user_exists = db.query(User.id).filter(User.id == user_id).first()
    if user_exists is None:
        raise HTTPException(status_code=404, detail="User not found")


@router.get(
    "/users/{user_id}/reading-book",
    response_model=ReadingBookResponse | None,
)
def get_reading_book(user_id: int, db: Session = Depends(get_db)):
    _ensure_user(user_id, db)
    return (
        db.query(ReadingBook)
        .filter(ReadingBook.user_id == user_id)
        .first()
    )


@router.put(
    "/users/{user_id}/reading-book",
    response_model=ReadingBookResponse,
)
def upsert_reading_book(
    user_id: int,
    data: ReadingBookUpsert,
    db: Session = Depends(get_db),
):
    _ensure_user(user_id, db)
    reading_book = (
        db.query(ReadingBook)
        .filter(ReadingBook.user_id == user_id)
        .first()
    )
    now = app_now()

    if reading_book is None:
        reading_book = ReadingBook(
            user_id=user_id,
            title=data.title,
            current_page=data.current_page,
            total_pages=data.total_pages,
            notes=data.notes,
            created_at=now,
            updated_at=now,
        )
        db.add(reading_book)
    else:
        reading_book.title = data.title
        reading_book.current_page = data.current_page
        reading_book.total_pages = data.total_pages
        reading_book.notes = data.notes
        reading_book.updated_at = now

    try:
        db.commit()
        db.refresh(reading_book)
    except Exception:
        db.rollback()
        raise
    return reading_book


@router.delete("/users/{user_id}/reading-book")
def delete_reading_book(user_id: int, db: Session = Depends(get_db)):
    _ensure_user(user_id, db)
    reading_book = (
        db.query(ReadingBook)
        .filter(ReadingBook.user_id == user_id)
        .first()
    )
    if reading_book is None:
        raise HTTPException(status_code=404, detail="Reading book not found")

    db.delete(reading_book)
    db.commit()
    return {"message": "Reading book deleted"}
