def test_task_crud_completion_and_validation(client, auth_headers, user_id):
    invalid_date = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={"name": "Consulta", "date": "29/07/2026", "time": "10:00"},
    )
    assert invalid_date.status_code == 422

    invalid_time = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={"name": "Consulta", "date": "2026-07-29", "time": "25:00"},
    )
    assert invalid_time.status_code == 422

    created = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={"name": "  Consulta  ", "date": "2026-07-29", "time": "10:00"},
    )
    assert created.status_code == 200
    task = created.json()
    assert task["name"] == "Consulta"
    assert task["date"] == "2026-07-29"
    assert task["time"] == "10:00"
    task_id = task["id"]

    updated = client.put(
        f"/api/tasks/{task_id}",
        headers=auth_headers,
        json={"name": "Consulta médica", "time": "10:30"},
    )
    assert updated.status_code == 200
    assert updated.json()["time"] == "10:30"

    completed = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=auth_headers,
    )
    assert completed.status_code == 200
    assert completed.json()["completed_at"] is not None

    reopened = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=auth_headers,
    )
    assert reopened.status_code == 200
    assert reopened.json()["completed_at"] is None

    listed = client.get(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    assert client.delete(
        f"/api/tasks/{task_id}",
        headers=auth_headers,
    ).status_code == 200
