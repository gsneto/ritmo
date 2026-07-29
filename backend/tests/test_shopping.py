from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event

from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

from database import create_database_engine, init_db
from models.shopping import ShoppingList
from routers import shopping as shopping_router
from schemas.shopping import ShoppingItemCheck


def test_shopping_flow_and_monthly_history(client, auth_headers, user_id):
    invalid_kind = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Compra",
            "kind": "yearly",
            "planned_date": "2026-08-05",
        },
    )
    assert invalid_kind.status_code == 422

    created = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "  Compra mensal  ",
            "kind": "monthly",
            "planned_date": "2026-08-05",
        },
    )
    assert created.status_code == 200
    shopping_list = created.json()
    assert shopping_list["name"] == "Compra mensal"
    assert shopping_list["total_cents"] == 0
    list_id = shopping_list["id"]

    rice = client.post(
        f"/api/shopping-lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "  Arroz  "},
    )
    assert rice.status_code == 200
    assert rice.json()["name"] == "Arroz"
    rice_id = rice.json()["id"]

    soap = client.post(
        f"/api/shopping-lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Sabonete"},
    )
    assert soap.status_code == 200

    missing_price = client.put(
        f"/api/shopping-items/{rice_id}/check",
        headers=auth_headers,
        json={"checked": True},
    )
    assert missing_price.status_code == 422

    negative_price = client.put(
        f"/api/shopping-items/{rice_id}/check",
        headers=auth_headers,
        json={"checked": True, "price_cents": -1},
    )
    assert negative_price.status_code == 422

    boolean_price = client.put(
        f"/api/shopping-items/{rice_id}/check",
        headers=auth_headers,
        json={"checked": True, "price_cents": True},
    )
    assert boolean_price.status_code == 422

    checked = client.put(
        f"/api/shopping-items/{rice_id}/check",
        headers=auth_headers,
        json={"checked": True, "price_cents": 1290},
    )
    assert checked.status_code == 200
    assert checked.json()["price_cents"] == 1290
    assert checked.json()["checked_at"] is not None

    finished = client.post(
        f"/api/shopping-lists/{list_id}/finish",
        headers=auth_headers,
    )
    assert finished.status_code == 200
    completed = finished.json()
    assert completed["total_cents"] == 1290
    assert completed["completed_on"] is not None
    assert completed["completed_at"] is not None
    assert len(completed["items"]) == 2

    repeated_finish = client.post(
        f"/api/shopping-lists/{list_id}/finish",
        headers=auth_headers,
    )
    assert repeated_finish.status_code == 200
    assert repeated_finish.json()["total_cents"] == 1290
    assert repeated_finish.json()["completed_at"] == completed["completed_at"]

    history_month = completed["completed_on"][:7]
    history = client.get(
        f"/api/users/{user_id}/shopping-history",
        headers=auth_headers,
        params={"month": history_month},
    )
    assert history.status_code == 200
    summary = history.json()
    assert summary["month"] == history_month
    assert summary["total_cents"] == 1290
    assert summary["purchase_count"] == 1
    assert summary["average_cents"] == 1290
    assert summary["lists"][0]["id"] == list_id

    assert client.post(
        f"/api/shopping-lists/{list_id}/items",
        headers=auth_headers,
        json={"name": "Feijão"},
    ).status_code == 409
    assert client.delete(
        f"/api/shopping-lists/{list_id}",
        headers=auth_headers,
    ).status_code == 409

    reopened = client.post(
        f"/api/shopping-lists/{list_id}/reopen",
        headers=auth_headers,
    )
    assert reopened.status_code == 200
    reopened_list = reopened.json()
    assert reopened_list["completed_on"] is None
    assert reopened_list["completed_at"] is None
    assert reopened_list["total_cents"] == 0
    assert reopened_list["items"][0]["checked_at"] is not None
    assert reopened_list["items"][0]["price_cents"] == 1290

    repeated_reopen = client.post(
        f"/api/shopping-lists/{list_id}/reopen",
        headers=auth_headers,
    )
    assert repeated_reopen.status_code == 200
    assert repeated_reopen.json()["completed_at"] is None

    corrected = client.put(
        f"/api/shopping-items/{rice_id}/check",
        headers=auth_headers,
        json={"checked": True, "price_cents": 1590},
    )
    assert corrected.status_code == 200
    assert corrected.json()["price_cents"] == 1590

    refinished = client.post(
        f"/api/shopping-lists/{list_id}/finish",
        headers=auth_headers,
    )
    assert refinished.status_code == 200
    assert refinished.json()["total_cents"] == 1590

    corrected_history = client.get(
        f"/api/users/{user_id}/shopping-history",
        headers=auth_headers,
        params={"month": history_month},
    )
    assert corrected_history.status_code == 200
    assert corrected_history.json()["total_cents"] == 1590


def test_shopping_is_scoped_by_profile_and_reset_cascades(
    client,
    auth_headers,
):
    users = client.get("/api/users", headers=auth_headers).json()
    first_user_id = users[0]["id"]
    second_user_id = users[1]["id"]

    first_list = client.post(
        f"/api/users/{first_user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Fraldas",
            "kind": "weekly",
            "planned_date": "2026-08-02",
        },
    ).json()
    first_item = client.post(
        f"/api/shopping-lists/{first_list['id']}/items",
        headers=auth_headers,
        json={"name": "Pacote tamanho M"},
    ).json()

    second_list = client.post(
        f"/api/users/{second_user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Corte de cabelo",
            "kind": "one_time",
            "planned_date": "2026-08-03",
        },
    ).json()

    first_lists = client.get(
        f"/api/users/{first_user_id}/shopping-lists",
        headers=auth_headers,
    ).json()
    second_lists = client.get(
        f"/api/users/{second_user_id}/shopping-lists",
        headers=auth_headers,
    ).json()
    assert [item["id"] for item in first_lists] == [first_list["id"]]
    assert [item["id"] for item in second_lists] == [second_list["id"]]

    reset = client.delete(
        f"/api/users/{first_user_id}/data",
        headers=auth_headers,
    )
    assert reset.status_code == 200
    assert client.get(
        f"/api/users/{first_user_id}/shopping-lists",
        headers=auth_headers,
    ).json() == []
    assert client.get(
        f"/api/shopping-lists/{first_list['id']}",
        headers=auth_headers,
    ).status_code == 404
    assert client.put(
        f"/api/shopping-items/{first_item['id']}",
        headers=auth_headers,
        json={"name": "Órfão"},
    ).status_code == 404
    assert len(client.get(
        f"/api/users/{second_user_id}/shopping-lists",
        headers=auth_headers,
    ).json()) == 1


def test_shopping_mutations_claim_parent_and_snapshot_exact_total(
    client,
    auth_headers,
    user_id,
    context,
):
    shopping_list = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Teste de integridade",
            "kind": "one_time",
            "planned_date": "2026-08-04",
        },
    ).json()
    item_ids = [
        client.post(
            f"/api/shopping-lists/{shopping_list['id']}/items",
            headers=auth_headers,
            json={"name": name},
        ).json()["id"]
        for name in ("Item A", "Item B")
    ]

    for item_id, price_cents in zip(item_ids, (10, 20), strict=True):
        response = client.put(
            f"/api/shopping-items/{item_id}/check",
            headers=auth_headers,
            json={"checked": True, "price_cents": price_cents},
        )
        assert response.status_code == 200

    finished = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/finish",
        headers=auth_headers,
    )
    assert finished.status_code == 200
    assert finished.json()["total_cents"] == 30

    with context.session_factory() as db:
        stored_list = db.get(ShoppingList, shopping_list["id"])
        assert stored_list is not None
        assert stored_list.revision == 5
        checked_total = sum(
            item.price_cents or 0
            for item in stored_list.items
            if item.checked_at is not None
        )
        assert stored_list.total_cents == checked_total == 30


def test_check_and_finish_are_serialized_on_sqlite(
    client,
    auth_headers,
    user_id,
    context,
    monkeypatch,
):
    shopping_list = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Compra concorrente",
            "kind": "one_time",
            "planned_date": "2026-08-04",
        },
    ).json()
    first_item = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/items",
        headers=auth_headers,
        json={"name": "Item já marcado"},
    ).json()
    second_item = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/items",
        headers=auth_headers,
        json={"name": "Item simultâneo"},
    ).json()
    assert client.put(
        f"/api/shopping-items/{first_item['id']}/check",
        headers=auth_headers,
        json={"checked": True, "price_cents": 100},
    ).status_code == 200

    item_claimed = Event()
    finish_attempted = Event()
    release_item_commit = Event()
    original_claim_item = shopping_router._claim_shopping_item
    original_claim_list = shopping_router._claim_shopping_list

    def pause_after_item_claim(item_id, db):
        item = original_claim_item(item_id, db)
        item_claimed.set()
        assert release_item_commit.wait(timeout=5)
        return item

    def observe_finish_claim(list_id, db):
        finish_attempted.set()
        return original_claim_list(list_id, db)

    monkeypatch.setattr(
        shopping_router,
        "_claim_shopping_item",
        pause_after_item_claim,
    )
    monkeypatch.setattr(
        shopping_router,
        "_claim_shopping_list",
        observe_finish_claim,
    )

    def check_second_item():
        with context.session_factory() as db:
            return shopping_router.check_shopping_item(
                second_item["id"],
                ShoppingItemCheck(checked=True, price_cents=200),
                db,
            )

    def finish_list():
        with context.session_factory() as db:
            return shopping_router.finish_shopping_list(
                shopping_list["id"],
                db,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        check_future = executor.submit(check_second_item)
        assert item_claimed.wait(timeout=5)
        finish_future = executor.submit(finish_list)
        assert finish_attempted.wait(timeout=5)
        release_item_commit.set()
        check_future.result(timeout=5)
        finished = finish_future.result(timeout=5)

    assert finished.total_cents == 300
    assert sum(
        item.price_cents or 0
        for item in finished.items
        if item.checked_at is not None
    ) == 300


def test_shopping_routes_are_protected_and_database_init_is_idempotent(
    context,
    auth_headers,
):
    unauthorized = context.client.get("/api/users/1/shopping-lists")
    assert unauthorized.status_code == 401

    invalid_month = context.client.get(
        "/api/users/1/shopping-history",
        headers=auth_headers,
        params={"month": "0000-01"},
    )
    assert invalid_month.status_code == 422

    init_db(bind=context.engine, session_factory=context.session_factory)
    init_db(bind=context.engine, session_factory=context.session_factory)
    table_names = set(inspect(context.engine).get_table_names())
    assert {"shopping_lists", "shopping_items"}.issubset(table_names)


def test_finance_budget_quantity_price_history_and_automatic_next_list(
    client,
    auth_headers,
    user_id,
):
    invalid_repeat = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Avulsa inválida",
            "kind": "one_time",
            "category": "other",
            "planned_date": "2026-01-31",
            "repeat_enabled": True,
        },
    )
    assert invalid_repeat.status_code == 422

    created = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Fraldas da filha",
            "kind": "monthly",
            "category": "child",
            "planned_date": "2026-01-31",
            "budget_cents": 20_000,
            "repeat_enabled": True,
        },
    )
    assert created.status_code == 200
    shopping_list = created.json()
    assert shopping_list["category"] == "child"
    assert shopping_list["budget_cents"] == 20_000
    assert shopping_list["repeat_enabled"] is True

    invalid_quantity = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/items",
        headers=auth_headers,
        json={"name": "Quantidade inválida", "quantity": 0},
    )
    assert invalid_quantity.status_code == 422

    item = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/items",
        headers=auth_headers,
        json={"name": "Fralda tamanho M", "quantity": 3},
    )
    assert item.status_code == 200
    item_id = item.json()["id"]
    assert item.json()["quantity"] == 3

    checked = client.put(
        f"/api/shopping-items/{item_id}/check",
        headers=auth_headers,
        json={
            "checked": True,
            "quantity": 3,
            "unit_price_cents": 4_990,
        },
    )
    assert checked.status_code == 200
    assert checked.json()["unit_price_cents"] == 4_990
    assert checked.json()["price_cents"] == 14_970

    finished = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/finish",
        headers=auth_headers,
    )
    assert finished.status_code == 200
    completed = finished.json()
    assert completed["total_cents"] == 14_970
    assert completed["next_list_id"] is not None

    active_lists = client.get(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        params={"completed": False},
    ).json()
    assert len(active_lists) == 1
    next_list = active_lists[0]
    assert next_list["id"] == completed["next_list_id"]
    assert next_list["planned_date"] == "2026-02-28"
    assert next_list["category"] == "child"
    assert next_list["budget_cents"] == 20_000
    assert next_list["items"][0]["quantity"] == 3
    assert next_list["items"][0]["price_cents"] is None

    # Retrying finish is safe and never creates a duplicate recurrence.
    repeated = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/finish",
        headers=auth_headers,
    )
    assert repeated.status_code == 200
    assert repeated.json()["next_list_id"] == next_list["id"]
    assert len(client.get(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        params={"completed": False},
    ).json()) == 1

    purchased_month = completed["completed_on"][:7]
    budget = client.put(
        f"/api/users/{user_id}/shopping-budgets/{purchased_month}",
        headers=auth_headers,
        json={"budget_cents": 50_000},
    )
    assert budget.status_code == 200
    assert budget.json() == {
        "month": purchased_month,
        "budget_cents": 50_000,
    }

    summary = client.get(
        f"/api/users/{user_id}/shopping-history",
        headers=auth_headers,
        params={"month": purchased_month},
    )
    assert summary.status_code == 200
    finance = summary.json()
    assert finance["budget_cents"] == 50_000
    assert finance["planned_cents"] == 50_000
    assert finance["total_cents"] == 14_970
    assert finance["balance_cents"] == 35_030
    assert finance["previous_month_total_cents"] == 0
    assert finance["change_cents"] == 14_970
    assert finance["change_percent"] is None
    assert finance["category_totals"] == [{
        "category": "child",
        "total_cents": 14_970,
    }]

    history = client.get(
        f"/api/users/{user_id}/shopping-price-history",
        headers=auth_headers,
        params={"item_name": "  FRALDA TAMANHO M  "},
    )
    assert history.status_code == 200
    assert history.json()["entries"][0] == {
        "item_id": item_id,
        "list_id": shopping_list["id"],
        "list_name": "Fraldas da filha",
        "item_name": "Fralda tamanho M",
        "quantity": 3,
        "unit_price_cents": 4_990,
        "total_cents": 14_970,
        "purchased_on": completed["completed_on"],
    }


def test_month_comparison_and_budget_reset(
    client,
    auth_headers,
    user_id,
    context,
):
    created = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Mercado anterior",
            "kind": "one_time",
            "category": "groceries",
            "planned_date": "2026-06-10",
        },
    ).json()
    item = client.post(
        f"/api/shopping-lists/{created['id']}/items",
        headers=auth_headers,
        json={"name": "Arroz", "quantity": 1},
    ).json()
    assert client.put(
        f"/api/shopping-items/{item['id']}/check",
        headers=auth_headers,
        json={"checked": True, "unit_price_cents": 10_000},
    ).status_code == 200
    assert client.post(
        f"/api/shopping-lists/{created['id']}/finish",
        headers=auth_headers,
    ).status_code == 200

    with context.session_factory() as db:
        stored = db.get(ShoppingList, created["id"])
        stored.completed_on = date(2026, 6, 15)
        db.commit()

    july = client.get(
        f"/api/users/{user_id}/shopping-history",
        headers=auth_headers,
        params={"month": "2026-07"},
    ).json()
    assert july["total_cents"] == 0
    assert july["previous_month_total_cents"] == 10_000
    assert july["change_cents"] == -10_000
    assert july["change_percent"] == -100.0

    assert client.put(
        f"/api/users/{user_id}/shopping-budgets/2026-07",
        headers=auth_headers,
        json={"budget_cents": 30_000},
    ).status_code == 200
    assert client.delete(
        f"/api/users/{user_id}/data",
        headers=auth_headers,
    ).status_code == 200
    reset_summary = client.get(
        f"/api/users/{user_id}/shopping-history",
        headers=auth_headers,
        params={"month": "2026-07"},
    ).json()
    assert reset_summary["budget_cents"] == 0
    assert reset_summary["total_cents"] == 0


def test_legacy_shopping_schema_is_migrated_without_data_loss(tmp_path):
    legacy_engine = create_database_engine(
        f"sqlite:///{(tmp_path / 'legacy-shopping.db').as_posix()}",
    )
    with legacy_engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE users ("
            "id INTEGER PRIMARY KEY, profile_id VARCHAR(50) NOT NULL UNIQUE, "
            "name VARCHAR(100) NOT NULL, initials VARCHAR(3) NOT NULL, "
            "theme VARCHAR(5), created_at DATETIME)"
        ))
        connection.execute(text(
            "CREATE TABLE shopping_lists ("
            "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
            "name VARCHAR(200) NOT NULL, kind VARCHAR(20) NOT NULL, "
            "planned_date DATE NOT NULL, completed_on DATE, completed_at DATETIME, "
            "total_cents INTEGER NOT NULL DEFAULT 0, "
            "revision INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL)"
        ))
        connection.execute(text(
            "CREATE TABLE shopping_items ("
            "id INTEGER PRIMARY KEY, shopping_list_id INTEGER NOT NULL, "
            "name VARCHAR(200) NOT NULL, checked_at DATETIME, "
            "price_cents INTEGER, created_at DATETIME NOT NULL)"
        ))
        connection.execute(text(
            "INSERT INTO users "
            "(id, profile_id, name, initials, theme, created_at) "
            "VALUES (1, 'legacy', 'Legado', 'LG', 'light', CURRENT_TIMESTAMP)"
        ))
        connection.execute(text(
            "INSERT INTO shopping_lists "
            "(id, user_id, name, kind, planned_date, total_cents, revision, created_at) "
            "VALUES (1, 1, 'Compra preservada', 'monthly', '2026-07-01', "
            "1290, 0, CURRENT_TIMESTAMP)"
        ))
        connection.execute(text(
            "INSERT INTO shopping_items "
            "(id, shopping_list_id, name, checked_at, price_cents, created_at) "
            "VALUES (1, 1, 'Arroz', CURRENT_TIMESTAMP, 1290, CURRENT_TIMESTAMP)"
        ))

    legacy_sessions = sessionmaker(bind=legacy_engine)
    init_db(bind=legacy_engine, session_factory=legacy_sessions)
    init_db(bind=legacy_engine, session_factory=legacy_sessions)

    list_columns = {
        column["name"]
        for column in inspect(legacy_engine).get_columns("shopping_lists")
    }
    item_columns = {
        column["name"]
        for column in inspect(legacy_engine).get_columns("shopping_items")
    }
    assert {
        "category",
        "budget_cents",
        "repeat_enabled",
        "next_list_id",
    }.issubset(list_columns)
    assert {"quantity", "unit_price_cents"}.issubset(item_columns)
    with legacy_engine.connect() as connection:
        legacy_list = connection.execute(text(
            "SELECT name, category, repeat_enabled FROM shopping_lists WHERE id = 1"
        )).one()
        legacy_item = connection.execute(text(
            "SELECT name, quantity, price_cents, unit_price_cents "
            "FROM shopping_items WHERE id = 1"
        )).one()
    assert tuple(legacy_list) == ("Compra preservada", "other", 0)
    assert tuple(legacy_item) == ("Arroz", 1, 1290, 1290)
    legacy_engine.dispose()
