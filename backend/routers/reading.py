from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models.reading import ReadingBook, ReadingNote, ReadingSession
from models.user import User
from schemas.reading import (
    ReadingBookCreate,
    ReadingBookResponse,
    ReadingBookUpdate,
    ReadingBookUpsert,
    ReadingNoteCreate,
    ReadingNoteResponse,
    ReadingSessionCreate,
    ReadingSessionResponse,
    ReadingSummaryResponse,
)
from time_utils import app_now, app_today


router = APIRouter(prefix="/api", tags=["reading"])


def _ensure_user(user_id: int, db: Session) -> None:
    user_exists = db.query(User.id).filter(User.id == user_id).first()
    if user_exists is None:
        raise HTTPException(status_code=404, detail="User not found")


def _get_book(book_id: int, db: Session) -> ReadingBook:
    book = db.query(ReadingBook).filter(ReadingBook.id == book_id).first()
    if book is None:
        raise HTTPException(status_code=404, detail="Reading book not found")
    return book


def _deactivate_other_books(book: ReadingBook, db: Session) -> None:
    db.query(ReadingBook).filter(
        ReadingBook.user_id == book.user_id,
        ReadingBook.id != book.id,
        ReadingBook.is_active.is_(True),
    ).update({ReadingBook.is_active: False}, synchronize_session="fetch")


def _normalize_book_state(book: ReadingBook, db: Session) -> None:
    now = app_now()
    if book.current_page >= book.total_pages:
        book.current_page = book.total_pages
        book.status = "concluido"
        book.is_active = False
        book.completed_at = book.completed_at or now
    else:
        book.completed_at = None
        if book.is_active:
            _deactivate_other_books(book, db)
            book.status = "lendo"
        elif book.status == "concluido":
            book.status = "lendo"
        elif book.status == "quero_ler":
            book.is_active = False
    book.updated_at = now


def _commit_and_refresh(db: Session, value):
    try:
        db.commit()
        db.refresh(value)
    except Exception:
        db.rollback()
        raise
    return value


@router.get(
    "/users/{user_id}/reading-book",
    response_model=ReadingBookResponse | None,
)
def get_reading_book(user_id: int, db: Session = Depends(get_db)):
    """Compatibility route: return only the book selected as active."""
    _ensure_user(user_id, db)
    return (
        db.query(ReadingBook)
        .filter(
            ReadingBook.user_id == user_id,
            ReadingBook.is_active.is_(True),
        )
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
    """Compatibility route that preserves the original single-book client."""
    _ensure_user(user_id, db)
    reading_book = (
        db.query(ReadingBook)
        .filter(
            ReadingBook.user_id == user_id,
            ReadingBook.is_active.is_(True),
        )
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
            status="lendo",
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(reading_book)
        db.flush()
    else:
        reading_book.title = data.title
        reading_book.current_page = data.current_page
        reading_book.total_pages = data.total_pages
        reading_book.notes = data.notes

    _normalize_book_state(reading_book, db)
    return _commit_and_refresh(db, reading_book)


@router.delete("/users/{user_id}/reading-book")
def delete_reading_book(user_id: int, db: Session = Depends(get_db)):
    """Compatibility route: delete the selected book, not the whole library."""
    _ensure_user(user_id, db)
    reading_book = (
        db.query(ReadingBook)
        .filter(
            ReadingBook.user_id == user_id,
            ReadingBook.is_active.is_(True),
        )
        .first()
    )
    if reading_book is None:
        raise HTTPException(status_code=404, detail="Reading book not found")

    db.delete(reading_book)
    db.commit()
    return {"message": "Reading book deleted"}


@router.get(
    "/users/{user_id}/reading-books",
    response_model=list[ReadingBookResponse],
)
def list_reading_books(user_id: int, db: Session = Depends(get_db)):
    _ensure_user(user_id, db)
    return (
        db.query(ReadingBook)
        .filter(ReadingBook.user_id == user_id)
        .order_by(
            ReadingBook.is_active.desc(),
            ReadingBook.updated_at.desc(),
            ReadingBook.id.desc(),
        )
        .all()
    )


@router.post(
    "/users/{user_id}/reading-books",
    response_model=ReadingBookResponse,
    status_code=201,
)
def create_reading_book(
    user_id: int,
    data: ReadingBookCreate,
    db: Session = Depends(get_db),
):
    _ensure_user(user_id, db)
    now = app_now()
    reading_book = ReadingBook(
        user_id=user_id,
        title=data.title,
        current_page=data.current_page,
        total_pages=data.total_pages,
        notes=data.notes,
        status=data.status,
        is_active=data.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(reading_book)
    db.flush()
    _normalize_book_state(reading_book, db)
    return _commit_and_refresh(db, reading_book)


@router.put(
    "/reading-books/{book_id}",
    response_model=ReadingBookResponse,
)
def update_reading_book(
    book_id: int,
    data: ReadingBookUpdate,
    db: Session = Depends(get_db),
):
    book = _get_book(book_id, db)
    changes = data.model_dump(exclude_unset=True)

    next_current_page = changes.get("current_page", book.current_page)
    next_total_pages = changes.get("total_pages", book.total_pages)
    if next_current_page > next_total_pages:
        raise HTTPException(
            status_code=422,
            detail="current_page cannot be greater than total_pages",
        )

    requested_status = changes.get("status")
    if requested_status == "concluido":
        changes["current_page"] = next_total_pages
    if requested_status == "quero_ler":
        changes["is_active"] = False

    for field, value in changes.items():
        setattr(book, field, value)
    _normalize_book_state(book, db)
    return _commit_and_refresh(db, book)


@router.post(
    "/reading-books/{book_id}/activate",
    response_model=ReadingBookResponse,
)
def activate_reading_book(book_id: int, db: Session = Depends(get_db)):
    book = _get_book(book_id, db)
    if book.current_page >= book.total_pages:
        raise HTTPException(
            status_code=409,
            detail="A completed book cannot be selected as active",
        )
    book.is_active = True
    _normalize_book_state(book, db)
    return _commit_and_refresh(db, book)


@router.delete("/reading-books/{book_id}")
def delete_library_book(book_id: int, db: Session = Depends(get_db)):
    book = _get_book(book_id, db)
    db.delete(book)
    db.commit()
    return {"message": "Reading book deleted"}


@router.get(
    "/reading-books/{book_id}/sessions",
    response_model=list[ReadingSessionResponse],
)
def list_book_sessions(book_id: int, db: Session = Depends(get_db)):
    _get_book(book_id, db)
    return (
        db.query(ReadingSession)
        .options(joinedload(ReadingSession.book))
        .filter(ReadingSession.book_id == book_id)
        .order_by(
            ReadingSession.session_date.desc(),
            ReadingSession.id.desc(),
        )
        .all()
    )


@router.get(
    "/users/{user_id}/reading-sessions",
    response_model=list[ReadingSessionResponse],
)
def list_user_reading_sessions(
    user_id: int,
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
):
    _ensure_user(user_id, db)
    return (
        db.query(ReadingSession)
        .join(ReadingSession.book)
        .options(joinedload(ReadingSession.book))
        .filter(ReadingBook.user_id == user_id)
        .order_by(
            ReadingSession.session_date.desc(),
            ReadingSession.id.desc(),
        )
        .limit(limit)
        .all()
    )


@router.post(
    "/reading-books/{book_id}/sessions",
    response_model=ReadingSessionResponse,
    status_code=201,
)
def create_reading_session(
    book_id: int,
    data: ReadingSessionCreate,
    db: Session = Depends(get_db),
):
    book = _get_book(book_id, db)
    if data.start_page > book.total_pages or data.end_page > book.total_pages:
        raise HTTPException(
            status_code=422,
            detail="session pages cannot exceed the book total",
        )
    now = app_now()
    session = ReadingSession(
        book_id=book.id,
        session_date=data.session_date,
        start_page=data.start_page,
        end_page=data.end_page,
        duration_minutes=data.duration_minutes,
        source=data.source,
        created_at=now,
    )
    db.add(session)
    if data.end_page > book.current_page:
        book.current_page = data.end_page
    if not book.is_active and book.current_page < book.total_pages:
        book.status = "lendo"
    _normalize_book_state(book, db)
    try:
        db.commit()
        db.refresh(session)
    except Exception:
        db.rollback()
        raise
    return session


@router.delete("/reading-sessions/{session_id}")
def delete_reading_session(session_id: int, db: Session = Depends(get_db)):
    session = (
        db.query(ReadingSession)
        .filter(ReadingSession.id == session_id)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Reading session not found")
    db.delete(session)
    db.commit()
    return {"message": "Reading session deleted"}


@router.get(
    "/reading-books/{book_id}/notes",
    response_model=list[ReadingNoteResponse],
)
def list_reading_notes(book_id: int, db: Session = Depends(get_db)):
    _get_book(book_id, db)
    return (
        db.query(ReadingNote)
        .filter(ReadingNote.book_id == book_id)
        .order_by(ReadingNote.note_date.desc(), ReadingNote.id.desc())
        .all()
    )


@router.post(
    "/reading-books/{book_id}/notes",
    response_model=ReadingNoteResponse,
    status_code=201,
)
def create_reading_note(
    book_id: int,
    data: ReadingNoteCreate,
    db: Session = Depends(get_db),
):
    book = _get_book(book_id, db)
    if data.page > book.total_pages:
        raise HTTPException(
            status_code=422,
            detail="note page cannot exceed the book total",
        )
    now = app_now()
    note = ReadingNote(
        book_id=book.id,
        note_date=data.note_date,
        page=data.page,
        content=data.content,
        created_at=now,
        updated_at=now,
    )
    db.add(note)
    return _commit_and_refresh(db, note)


@router.delete("/reading-notes/{note_id}")
def delete_reading_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(ReadingNote).filter(ReadingNote.id == note_id).first()
    if note is None:
        raise HTTPException(status_code=404, detail="Reading note not found")
    db.delete(note)
    db.commit()
    return {"message": "Reading note deleted"}


@router.get(
    "/users/{user_id}/reading-summary",
    response_model=ReadingSummaryResponse,
)
def get_reading_summary(
    user_id: int,
    weeks: int = Query(default=8, ge=1, le=52),
    db: Session = Depends(get_db),
):
    _ensure_user(user_id, db)
    today = app_today()
    current_week_start = today - timedelta(days=today.weekday())
    first_week_start = current_week_start - timedelta(weeks=weeks - 1)
    last_week_end = current_week_start + timedelta(days=6)

    sessions = (
        db.query(ReadingSession)
        .join(ReadingSession.book)
        .options(joinedload(ReadingSession.book))
        .filter(
            ReadingBook.user_id == user_id,
            ReadingSession.session_date >= first_week_start,
            ReadingSession.session_date <= last_week_end,
        )
        .order_by(ReadingSession.session_date.asc(), ReadingSession.id.asc())
        .all()
    )
    buckets = [
        {
            "week_start": first_week_start + timedelta(weeks=index),
            "week_end": first_week_start
            + timedelta(weeks=index, days=6),
            "pages_read": 0,
            "duration_minutes": 0,
            "session_count": 0,
        }
        for index in range(weeks)
    ]
    for session in sessions:
        index = (session.session_date - first_week_start).days // 7
        if 0 <= index < len(buckets):
            buckets[index]["pages_read"] += session.pages_read
            buckets[index]["duration_minutes"] += session.duration_minutes
            buckets[index]["session_count"] += 1

    current = buckets[-1]
    recent_sessions = (
        db.query(ReadingSession)
        .join(ReadingSession.book)
        .options(joinedload(ReadingSession.book))
        .filter(ReadingBook.user_id == user_id)
        .order_by(
            ReadingSession.session_date.desc(),
            ReadingSession.id.desc(),
        )
        .limit(8)
        .all()
    )
    total_sessions = (
        db.query(ReadingSession)
        .join(ReadingSession.book)
        .filter(ReadingBook.user_id == user_id)
        .count()
    )
    return {
        "pages_this_week": current["pages_read"],
        "duration_this_week": current["duration_minutes"],
        "total_sessions": total_sessions,
        "recent_sessions": recent_sessions,
        "weeks": buckets,
    }
