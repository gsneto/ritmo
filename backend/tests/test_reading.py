import pytest
from fastapi import Depends
from sqlalchemy import inspect

from models.reading import ReadingBook
from routers.reading import router
from security import require_api_key


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


def test_reading_table_has_one_book_per_profile(context):
    ReadingBook.__table__.create(bind=context.engine, checkfirst=True)
    inspector = inspect(context.engine)
    constraints = inspector.get_unique_constraints("reading_books")
    indexes = inspector.get_indexes("reading_books")
    unique_user_id = (
        any(
            item.get("column_names") == ["user_id"]
            for item in constraints
        )
        or any(
            item.get("unique")
            and item.get("column_names") == ["user_id"]
            for item in indexes
        )
    )
    assert unique_user_id
