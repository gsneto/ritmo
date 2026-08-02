import pytest
from fastapi import Depends
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from database import create_database_engine, init_db
from models.reading import ReadingBook, ReadingNote, ReadingSession
from models.user import User
from routers.reading import router
from security import require_api_key
from time_utils import app_now, app_today


@pytest.fixture()
def reading_client(context):
    """Keep these tests runnable before and after main.py integration."""
    ReadingBook.__table__.create(bind=context.engine, checkfirst=True)
    application = context.client.app
    if not any(
        getattr(route, "path", None) == "/api/users/{user_id}/reading-book"
        for route in application.routes
    ):
        application.include_router(
            router,
            dependencies=[Depends(require_api_key)],
        )
    return context.client


def test_reading_book_upsert_progress_and_delete(
    reading_client,
    auth_headers,
    user_id,
):
    empty = reading_client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    )
    assert empty.status_code == 200
    assert empty.json() is None

    created = reading_client.put(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
        json={
            "title": "  Hábitos Atômicos  ",
            "current_page": 80,
            "total_pages": 320,
            "notes": "  Tornar o hábito óbvio.  ",
        },
    )
    assert created.status_code == 200
    book = created.json()
    assert book["title"] == "Hábitos Atômicos"
    assert book["notes"] == "Tornar o hábito óbvio."
    assert book["progress_percent"] == 25.0

    updated = reading_client.put(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
        json={
            "title": "Hábitos Atômicos",
            "current_page": 160,
            "total_pages": 320,
            "notes": "Revisar o capítulo sobre ambiente.",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == book["id"]
    assert updated.json()["progress_percent"] == 50.0

    fetched = reading_client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    )
    assert fetched.status_code == 200
    assert fetched.json()["current_page"] == 160

    deleted = reading_client.delete(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    )
    assert deleted.status_code == 200
    assert deleted.json() == {"message": "Reading book deleted"}

    missing = reading_client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    )
    assert missing.status_code == 200
    assert missing.json() is None


@pytest.mark.parametrize(
    ("payload", "error_fragment"),
    [
        (
            {
                "title": "Livro",
                "current_page": 101,
                "total_pages": 100,
                "notes": "",
            },
            "current_page cannot be greater than total_pages",
        ),
        (
            {
                "title": "Livro",
                "current_page": 0,
                "total_pages": 0,
                "notes": "",
            },
            "greater than or equal to 1",
        ),
        (
            {
                "title": "Livro",
                "current_page": 0,
                "total_pages": 100,
                "notes": "a" * 10_001,
            },
            "at most 10000 characters",
        ),
    ],
)
def test_reading_book_rejects_invalid_data(
    reading_client,
    auth_headers,
    user_id,
    payload,
    error_fragment,
):
    response = reading_client.put(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
        json=payload,
    )
    assert response.status_code == 422
    assert error_fragment in response.text


def test_reading_book_is_profile_scoped_and_protected(
    reading_client,
    auth_headers,
    user_id,
):
    assert (
        reading_client.get(f"/api/users/{user_id}/reading-book").status_code
        == 401
    )

    users = reading_client.get("/api/users", headers=auth_headers).json()
    other_user_id = next(user["id"] for user in users if user["id"] != user_id)

    created = reading_client.put(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
        json={
            "title": "Essencialismo",
            "current_page": 12,
            "total_pages": 272,
            "notes": "",
        },
    )
    assert created.status_code == 200

    other_profile = reading_client.get(
        f"/api/users/{other_user_id}/reading-book",
        headers=auth_headers,
    )
    assert other_profile.status_code == 200
    assert other_profile.json() is None

    missing_user = reading_client.get(
        "/api/users/999999/reading-book",
        headers=auth_headers,
    )
    assert missing_user.status_code == 404


def test_reading_table_has_at_most_one_active_book_per_profile(context):
    ReadingBook.__table__.create(bind=context.engine, checkfirst=True)
    inspector = inspect(context.engine)
    constraints = inspector.get_unique_constraints("reading_books")
    indexes = inspector.get_indexes("reading_books")
    one_active_book_index = (
        any(
            item.get("name") == "uq_reading_books_active_user"
            for item in constraints
        )
        or any(
            item.get("unique")
            and item.get("name") == "uq_reading_books_active_user"
            for item in indexes
        )
    )
    assert one_active_book_index


def test_active_reading_book_constraint_serializes_two_sessions(context, user_id):
    now = app_now()
    first_db = context.session_factory()
    second_db = context.session_factory()
    try:
        first_db.add(
            ReadingBook(
                user_id=user_id,
                title="Primeiro ativo",
                current_page=1,
                total_pages=100,
                notes="",
                status="lendo",
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        second_db.add(
            ReadingBook(
                user_id=user_id,
                title="Segundo ativo",
                current_page=1,
                total_pages=100,
                notes="",
                status="lendo",
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        first_db.commit()
        with pytest.raises(IntegrityError):
            second_db.commit()
        second_db.rollback()
    finally:
        first_db.close()
        second_db.close()


def test_reading_router_returns_conflict_for_integrity_race(
    reading_client,
    auth_headers,
    user_id,
    monkeypatch,
):
    original_commit = Session.commit
    should_fail = True

    def fail_first_commit(session):
        nonlocal should_fail
        if should_fail:
            should_fail = False
            raise IntegrityError("INSERT", {}, Exception("simulated race"))
        return original_commit(session)

    monkeypatch.setattr(Session, "commit", fail_first_commit)
    response = reading_client.post(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
        json={
            "title": "Conflito concorrente",
            "current_page": 1,
            "total_pages": 100,
            "notes": "",
            "status": "lendo",
            "is_active": True,
        },
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Another reading book is already active for this user"
    }


def test_library_supports_multiple_books_and_one_optional_active_book(
    reading_client,
    auth_headers,
    user_id,
):
    wishlist = reading_client.post(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
        json={
            "title": "A queda do céu",
            "current_page": 0,
            "total_pages": 736,
            "notes": "",
            "status": "quero_ler",
            "is_active": False,
        },
    )
    assert wishlist.status_code == 201

    active = reading_client.post(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
        json={
            "title": "Ideias para adiar o fim do mundo",
            "current_page": 12,
            "total_pages": 104,
            "notes": "",
            "status": "lendo",
            "is_active": True,
        },
    )
    assert active.status_code == 201
    assert active.json()["is_active"] is True

    library = reading_client.get(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
    )
    assert library.status_code == 200
    assert len(library.json()) == 2
    assert sum(book["is_active"] for book in library.json()) == 1

    activated = reading_client.post(
        f"/api/reading-books/{wishlist.json()['id']}/activate",
        headers=auth_headers,
    )
    assert activated.status_code == 200
    assert activated.json()["status"] == "lendo"

    library = reading_client.get(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
    ).json()
    assert sum(book["is_active"] for book in library) == 1
    assert next(
        book for book in library if book["id"] == active.json()["id"]
    )["is_active"] is False

    completed = reading_client.put(
        f"/api/reading-books/{wishlist.json()['id']}",
        headers=auth_headers,
        json={"status": "concluido"},
    )
    assert completed.status_code == 200
    assert completed.json()["current_page"] == 736
    assert completed.json()["progress_percent"] == 100
    assert completed.json()["is_active"] is False

    no_active = reading_client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    )
    assert no_active.status_code == 200
    assert no_active.json() is None


def test_reading_sessions_notes_and_weekly_summary(
    reading_client,
    auth_headers,
    user_id,
):
    book = reading_client.post(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
        json={
            "title": "O amanhã não está à venda",
            "current_page": 10,
            "total_pages": 96,
            "notes": "",
            "status": "lendo",
            "is_active": True,
        },
    ).json()
    today = app_today().isoformat()

    manual_session = reading_client.post(
        f"/api/reading-books/{book['id']}/sessions",
        headers=auth_headers,
        json={
            "session_date": today,
            "start_page": 10,
            "end_page": 28,
            "duration_minutes": 32,
            "source": "manual",
        },
    )
    assert manual_session.status_code == 201
    assert manual_session.json()["pages_read"] == 18
    assert manual_session.json()["book_title"] == book["title"]

    focus_session = reading_client.post(
        f"/api/reading-books/{book['id']}/sessions",
        headers=auth_headers,
        json={
            "session_date": today,
            "start_page": 28,
            "end_page": 28,
            "duration_minutes": 25,
            "source": "focus",
        },
    )
    assert focus_session.status_code == 201

    refreshed = reading_client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    )
    assert refreshed.json()["current_page"] == 28

    note = reading_client.post(
        f"/api/reading-books/{book['id']}/notes",
        headers=auth_headers,
        json={
            "note_date": today,
            "page": 24,
            "content": "  Guardar esta ideia para conversar com a família.  ",
        },
    )
    assert note.status_code == 201
    assert note.json()["content"] == (
        "Guardar esta ideia para conversar com a família."
    )

    notes = reading_client.get(
        f"/api/reading-books/{book['id']}/notes",
        headers=auth_headers,
    )
    assert [item["page"] for item in notes.json()] == [24]

    summary = reading_client.get(
        f"/api/users/{user_id}/reading-summary?weeks=4",
        headers=auth_headers,
    )
    assert summary.status_code == 200
    assert summary.json()["pages_this_week"] == 18
    assert summary.json()["duration_this_week"] == 57
    assert summary.json()["total_sessions"] == 2
    assert len(summary.json()["weeks"]) == 4


def test_reading_library_migration_preserves_legacy_book(tmp_path):
    database_path = tmp_path / "legacy-reading.db"
    engine = create_database_engine(f"sqlite:///{database_path.as_posix()}")
    User.__table__.create(bind=engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, profile_id, name, initials, theme) "
                "VALUES (42, 'legacy', 'Leitor', 'L', 'light')"
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE reading_books (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    current_page INTEGER NOT NULL,
                    total_pages INTEGER NOT NULL,
                    notes TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    CONSTRAINT uq_reading_books_user_id UNIQUE (user_id),
                    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO reading_books (
                    id, user_id, title, current_page, total_pages, notes,
                    created_at, updated_at
                ) VALUES (
                    9, 42, 'Livro preservado', 33, 120, 'Minha anotação',
                    '2026-07-20 10:00:00', '2026-07-28 11:00:00'
                )
                """
            )
        )

    sessions = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    init_db(bind=engine, session_factory=sessions)

    db = sessions()
    try:
        migrated = db.query(ReadingBook).filter_by(id=9).one()
        assert migrated.title == "Livro preservado"
        assert migrated.current_page == 33
        assert migrated.notes == "Minha anotação"
        assert migrated.status == "lendo"
        assert migrated.is_active is True

        second = ReadingBook(
            user_id=42,
            title="Segundo livro",
            current_page=0,
            total_pages=80,
            notes="",
            status="quero_ler",
            is_active=False,
            created_at=migrated.created_at,
            updated_at=migrated.updated_at,
        )
        db.add(second)
        db.commit()
        assert db.query(ReadingBook).filter_by(user_id=42).count() == 2
        assert db.query(ReadingSession).count() == 0
        assert db.query(ReadingNote).count() == 0
    finally:
        db.close()
        engine.dispose()
