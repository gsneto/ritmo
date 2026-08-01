import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import event

from models.reading import ReadingBook
from models.shopping import ShoppingList
from models.user import User
from services.anahi_context import (
    READING_CONTEXT_BOOK_LIMIT,
    build_anahi_context,
    select_anahi_scopes,
)


def _book(
    *,
    user_id: int,
    title: str,
    current_page: int,
    total_pages: int,
    status: str,
    now: datetime,
    is_active: bool = False,
    notes: str = "",
) -> ReadingBook:
    return ReadingBook(
        user_id=user_id,
        title=title,
        current_page=current_page,
        total_pages=total_pages,
        notes=notes,
        status=status,
        is_active=is_active,
        completed_at=now if status == "concluido" else None,
        created_at=now,
        updated_at=now,
    )


def _purchase(
    *,
    user_id: int,
    name: str,
    completed_on: date | None,
    total_cents: int,
    now: datetime,
) -> ShoppingList:
    return ShoppingList(
        user_id=user_id,
        name=name,
        kind="monthly",
        category="groceries",
        planned_date=completed_on or date(2026, 6, 15),
        budget_cents=None,
        repeat_enabled=False,
        next_list_id=None,
        completed_on=completed_on,
        completed_at=now if completed_on is not None else None,
        total_cents=total_cents,
        revision=0,
        created_at=now,
    )


def test_context_uses_only_selected_profile_and_requested_sources(
    context,
    user_id,
):
    selected_day = date(2026, 7, 31)
    now = datetime(2026, 7, 31, 12, tzinfo=ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        other_user = (
            db.query(User)
            .filter(User.id != user_id)
            .order_by(User.id)
            .first()
        )
        assert other_user is not None

        db.query(ReadingBook).delete(synchronize_session=False)
        db.query(ShoppingList).delete(synchronize_session=False)
        db.add_all(
            [
                _book(
                    user_id=user_id,
                    title="Livro quase pronto",
                    current_page=190,
                    total_pages=200,
                    status="lendo",
                    is_active=True,
                    notes="NAO ENVIE ESTA ANOTACAO",
                    now=now,
                ),
                _book(
                    user_id=user_id,
                    title="Livro pela metade",
                    current_page=50,
                    total_pages=100,
                    status="lendo",
                    now=now,
                ),
                _book(
                    user_id=user_id,
                    title="Ainda quero ler",
                    current_page=99,
                    total_pages=100,
                    status="quero_ler",
                    now=now,
                ),
                _book(
                    user_id=other_user.id,
                    title="LIVRO SECRETO DO OUTRO PERFIL",
                    current_page=999,
                    total_pages=1000,
                    status="lendo",
                    now=now,
                ),
                _purchase(
                    user_id=user_id,
                    name="Compra de junho",
                    completed_on=date(2026, 6, 20),
                    total_cents=12_345,
                    now=now,
                ),
                _purchase(
                    user_id=user_id,
                    name="Compra de julho",
                    completed_on=date(2026, 7, 20),
                    total_cents=5_000,
                    now=now,
                ),
                _purchase(
                    user_id=user_id,
                    name="Lista ainda aberta",
                    completed_on=None,
                    total_cents=0,
                    now=now,
                ),
                _purchase(
                    user_id=other_user.id,
                    name="COMPRA SECRETA DO OUTRO PERFIL",
                    completed_on=date(2026, 6, 20),
                    total_cents=99_999,
                    now=now,
                ),
            ]
        )
        db.commit()

        reading_context = build_anahi_context(
            db,
            user_id,
            today=selected_day,
            scopes={"reading"},
        )
        shopping_context = build_anahi_context(
            db,
            user_id,
            today=selected_day,
            scopes={"shopping"},
        )
    finally:
        db.close()

    assert reading_context is not None
    assert set(reading_context) == {"profile", "reference_date", "reading"}
    assert reading_context["reading"]["closest_to_finish"] == {
        "title": "Livro quase pronto",
        "current_page": 190,
        "total_pages": 200,
        "progress_percent": 95.0,
    }
    assert reading_context["reading"]["books"] == [
        {
            "title": "Livro quase pronto",
            "status": "lendo",
            "current_page": 190,
            "total_pages": 200,
            "progress_percent": 95.0,
            "is_active": True,
        },
        {
            "title": "Livro pela metade",
            "status": "lendo",
            "current_page": 50,
            "total_pages": 100,
            "progress_percent": 50.0,
            "is_active": False,
        },
    ]
    serialized_reading = json.dumps(reading_context, ensure_ascii=False)
    assert "LIVRO SECRETO DO OUTRO PERFIL" not in serialized_reading
    assert "NAO ENVIE ESTA ANOTACAO" not in serialized_reading
    assert "Ainda quero ler" not in serialized_reading

    assert shopping_context is not None
    assert set(shopping_context) == {"profile", "reference_date", "shopping"}
    assert shopping_context["shopping"]["previous_month"] == {
        "month": "2026-06",
        "total_cents": 12_345,
        "total_brl": "R$ 123,45",
        "purchase_count": 1,
    }
    assert shopping_context["shopping"]["current_month"]["total_cents"] == 5_000
    serialized_shopping = json.dumps(shopping_context, ensure_ascii=False)
    assert "COMPRA SECRETA DO OUTRO PERFIL" not in serialized_shopping


def test_reading_context_caps_lendo_books_and_keeps_closest(context, user_id):
    selected_day = date(2026, 7, 31)
    now = datetime(2026, 7, 31, 12, tzinfo=ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        db.query(ReadingBook).delete(synchronize_session=False)
        db.add_all(
            [
                _book(
                    user_id=user_id,
                    title=f"Livro lendo {index}",
                    current_page=index * 10,
                    total_pages=100,
                    status="lendo",
                    notes=f"nota privada {index}",
                    now=now,
                    is_active=index == 1,
                )
                for index in range(1, 8)
            ]
            + [
                _book(
                    user_id=user_id,
                    title="Livro quero ler",
                    current_page=99,
                    total_pages=100,
                    status="quero_ler",
                    notes="nota privada quero ler",
                    now=now,
                ),
                _book(
                    user_id=user_id,
                    title="Livro concluido",
                    current_page=100,
                    total_pages=100,
                    status="concluido",
                    notes="nota privada concluido",
                    now=now,
                ),
            ]
        )
        db.commit()

        reading_context = build_anahi_context(
            db,
            user_id,
            today=selected_day,
            scopes={"reading"},
        )
    finally:
        db.close()

    assert reading_context is not None
    books = reading_context["reading"]["books"]
    assert len(books) == READING_CONTEXT_BOOK_LIMIT
    assert all(book["status"] == "lendo" for book in books)
    assert reading_context["reading"]["closest_to_finish"] == {
        "title": "Livro lendo 7",
        "current_page": 70,
        "total_pages": 100,
        "progress_percent": 70.0,
    }
    serialized_reading = json.dumps(reading_context, ensure_ascii=False)
    assert "Livro quero ler" not in serialized_reading
    assert "Livro concluido" not in serialized_reading
    assert "nota privada" not in serialized_reading


def test_context_only_queries_requested_scopes(context, user_id):
    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.casefold())

    event.listen(context.engine, "before_cursor_execute", record_statement)
    db = context.session_factory()
    try:
        generic_context = build_anahi_context(
            db,
            user_id,
            today=date(2026, 7, 31),
            scopes=set(),
        )
        generic_sql = "\n".join(statements)
        statements.clear()

        reading_context = build_anahi_context(
            db,
            user_id,
            today=date(2026, 7, 31),
            scopes={"reading"},
        )
        reading_sql = "\n".join(statements)
    finally:
        db.close()
        event.remove(context.engine, "before_cursor_execute", record_statement)

    assert generic_context is not None
    assert set(generic_context) == {"profile", "reference_date"}
    assert reading_context is not None
    assert set(reading_context) == {"profile", "reference_date", "reading"}
    for table in (
        "habits",
        "habit_checkins",
        "tasks",
        "shopping_lists",
        "workouts",
        "workout_sessions",
    ):
        assert f"from {table}" not in generic_sql
        assert f"from {table}" not in reading_sql


def test_shopping_context_handles_previous_year_and_empty_month(context, user_id):
    selected_day = date(2026, 1, 15)
    now = datetime(2026, 1, 15, 12, tzinfo=ZoneInfo("America/Sao_Paulo"))
    db = context.session_factory()
    try:
        db.query(ShoppingList).delete(synchronize_session=False)
        db.add_all(
            [
                _purchase(
                    user_id=user_id,
                    name="Compra de dezembro",
                    completed_on=date(2025, 12, 31),
                    total_cents=4_321,
                    now=now,
                ),
                _purchase(
                    user_id=user_id,
                    name="Lista aberta de janeiro",
                    completed_on=None,
                    total_cents=9_999,
                    now=now,
                ),
            ]
        )
        db.commit()

        shopping_context = build_anahi_context(
            db,
            user_id,
            today=selected_day,
            scopes={"shopping"},
        )
    finally:
        db.close()

    assert shopping_context is not None
    assert shopping_context["shopping"]["previous_month"] == {
        "month": "2025-12",
        "total_cents": 4_321,
        "total_brl": "R$ 43,21",
        "purchase_count": 1,
    }
    assert shopping_context["shopping"]["current_month"] == {
        "month": "2026-01",
        "total_cents": 0,
        "total_brl": "R$ 0,00",
        "purchase_count": 0,
    }


def test_scope_selection_and_missing_profile_are_safe(context):
    assert select_anahi_scopes("Oi, ANAHÍ") == set()
    assert select_anahi_scopes("Qual livro estou mais perto de terminar?") == {
        "reading",
    }
    assert select_anahi_scopes("Quanto gastei nas compras do mês passado?") == {
        "shopping",
    }
    assert select_anahi_scopes("O que ainda está pendente hoje?") == {
        "habits",
        "tasks",
    }

    db = context.session_factory()
    try:
        assert build_anahi_context(db, 999_999, today=date(2026, 7, 31)) is None
    finally:
        db.close()
