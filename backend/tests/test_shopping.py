from concurrent.futures import ThreadPoolExecutor
from threading import Event

from sqlalchemy import inspect

from database import init_db
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
