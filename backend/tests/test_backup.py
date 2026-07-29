def test_backup_round_trip_preserves_all_main_modules(
    client,
    auth_headers,
    user_id,
):
    habit = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={
            "name": "Alongar",
            "time": "07:30",
            "active_days": [0, 2, 4],
        },
    ).json()
    assert client.post(
        f"/api/habits/{habit['id']}/checkin",
        headers=auth_headers,
        json={"date": "2026-07-29"},
    ).status_code == 200

    task = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={
            "name": "Separar documentos",
            "date": "2026-07-30",
            "time": "18:00",
            "recurrence": "weekly",
        },
    )
    assert task.status_code == 200

    shopping_list = client.post(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Compra da família",
            "kind": "monthly",
            "category": "groceries",
            "planned_date": "2026-08-02",
            "budget_cents": 100_000,
            "repeat_enabled": True,
        },
    ).json()
    shopping_item = client.post(
        f"/api/shopping-lists/{shopping_list['id']}/items",
        headers=auth_headers,
        json={"name": "Arroz", "quantity": 2},
    ).json()
    assert client.put(
        f"/api/shopping-items/{shopping_item['id']}/check",
        headers=auth_headers,
        json={
            "checked": True,
            "quantity": 2,
            "unit_price_cents": 1290,
        },
    ).status_code == 200
    assert client.put(
        f"/api/users/{user_id}/shopping-budgets/2026-08",
        headers=auth_headers,
        json={"budget_cents": 150_000},
    ).status_code == 200

    book = client.post(
        f"/api/users/{user_id}/reading-books",
        headers=auth_headers,
        json={
            "title": "A queda do céu",
            "current_page": 40,
            "total_pages": 600,
            "notes": "Ideias principais",
            "status": "lendo",
            "is_active": True,
        },
    ).json()
    assert client.post(
        f"/api/reading-books/{book['id']}/sessions",
        headers=auth_headers,
        json={
            "session_date": "2026-07-29",
            "start_page": 30,
            "end_page": 40,
            "duration_minutes": 25,
            "source": "focus",
        },
    ).status_code == 201
    assert client.post(
        f"/api/reading-books/{book['id']}/notes",
        headers=auth_headers,
        json={
            "note_date": "2026-07-29",
            "page": 37,
            "content": "Revisar esta passagem.",
        },
    ).status_code == 201

    workouts = client.get(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
    ).json()
    workout = next(item for item in workouts if item["exercises"])
    workout_session = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "backup-round-trip-workout",
            "rest_seconds": 75,
        },
    ).json()
    first_set_id = workout_session["exercises"][0]["sets"][0]["id"]
    assert client.put(
        f"/api/workout-session-sets/{first_set_id}",
        headers=auth_headers,
        json={
            "completed": True,
            "weight_kg": "8.50",
            "reps_completed": 10,
        },
    ).status_code == 200

    exported_response = client.get(
        f"/api/users/{user_id}/backup",
        headers=auth_headers,
    )
    assert exported_response.status_code == 200
    exported = exported_response.json()
    assert exported["version"] == 1
    assert exported["app"] == "Ritmo"
    assert exported["habits"][0]["active_days"] == [0, 2, 4]
    assert exported["shopping_lists"][0]["items"][0]["price_cents"] == 2580
    assert exported["reading_books"][0]["reading_notes"][0]["page"] == 37
    assert len(exported["workout_sessions"]) == 1

    assert client.delete(
        f"/api/users/{user_id}/data",
        headers=auth_headers,
    ).status_code == 200
    assert client.get(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
    ).json() == []

    restored_response = client.put(
        f"/api/users/{user_id}/backup",
        headers=auth_headers,
        json=exported,
    )
    assert restored_response.status_code == 200
    restored_counts = restored_response.json()["restored"]
    assert restored_counts["habits"] == 1
    assert restored_counts["shopping_lists"] == 1
    assert restored_counts["workout_sessions"] == 1
    assert restored_counts["reading_books"] == 1

    restored_habits = client.get(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
    ).json()
    assert restored_habits[0]["name"] == "Alongar"
    assert restored_habits[0]["check_ins"] == ["2026-07-29"]

    restored_shopping = client.get(
        f"/api/users/{user_id}/shopping-lists",
        headers=auth_headers,
    ).json()
    assert restored_shopping[0]["category"] == "groceries"
    assert restored_shopping[0]["items"][0]["quantity"] == 2

    restored_book = client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    ).json()
    assert restored_book["title"] == "A queda do céu"
    assert restored_book["current_page"] == 40

    restored_active_workout = client.get(
        f"/api/users/{user_id}/workout-sessions/active",
        headers=auth_headers,
    ).json()
    assert restored_active_workout["completed_sets"] == 1
    assert restored_active_workout["max_weight_kg"] == "8.50"


def test_invalid_or_unauthorized_backup_does_not_replace_data(
    client,
    auth_headers,
    user_id,
):
    assert client.get(f"/api/users/{user_id}/backup").status_code == 401

    habit = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "Persistir", "time": "08:00"},
    )
    assert habit.status_code == 200

    exported = client.get(
        f"/api/users/{user_id}/backup",
        headers=auth_headers,
    ).json()
    exported["version"] = 2
    invalid = client.put(
        f"/api/users/{user_id}/backup",
        headers=auth_headers,
        json=exported,
    )
    assert invalid.status_code == 422

    habits = client.get(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
    ).json()
    assert [item["name"] for item in habits] == ["Persistir"]
