from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.exc import IntegrityError

from models.habit import HabitCheckIn


def test_habit_crud_and_idempotent_checkin(client, auth_headers, user_id):
    assert client.get(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
    ).json() == []

    invalid_time = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "Caminhar", "time": "6:00"},
    )
    assert invalid_time.status_code == 422

    blank_name = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "  ", "time": "06:00"},
    )
    assert blank_name.status_code == 422

    created = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "  Caminhar  ", "time": "06:00"},
    )
    assert created.status_code == 200
    habit = created.json()
    assert habit["name"] == "Caminhar"
    assert habit["time"] == "06:00"
    assert habit["active_days"] == [0, 1, 2, 3, 4, 5, 6]
    habit_id = habit["id"]

    updated = client.put(
        f"/api/habits/{habit_id}",
        headers=auth_headers,
        json={"time": "07:15", "active_days": [0, 2, 4]},
    )
    assert updated.status_code == 200
    assert updated.json()["time"] == "07:15"
    assert updated.json()["active_days"] == [0, 2, 4]

    invalid_days = client.put(
        f"/api/habits/{habit_id}",
        headers=auth_headers,
        json={"active_days": []},
    )
    assert invalid_days.status_code == 422

    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
    first = client.post(
        f"/api/habits/{habit_id}/checkin",
        headers=auth_headers,
        json={"date": today},
    )
    second = client.post(
        f"/api/habits/{habit_id}/checkin",
        headers=auth_headers,
        json={"date": today},
    )
    assert first.status_code == second.status_code == 200
    assert second.json()["check_ins"] == [today]

    invalid_date = client.post(
        f"/api/habits/{habit_id}/checkin",
        headers=auth_headers,
        json={"date": "2026-02-30"},
    )
    assert invalid_date.status_code == 422
    invalid_path_date = client.delete(
        f"/api/habits/{habit_id}/checkin/not-a-date",
        headers=auth_headers,
    )
    assert invalid_path_date.status_code == 422

    removed = client.delete(
        f"/api/habits/{habit_id}/checkin/{today}",
        headers=auth_headers,
    )
    assert removed.status_code == 200

    deleted = client.delete(f"/api/habits/{habit_id}", headers=auth_headers)
    assert deleted.status_code == 200
    assert client.get(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
    ).json() == []


def test_database_rejects_duplicate_checkins(
    context,
    client,
    auth_headers,
    user_id,
):
    created = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "Água", "time": "08:00"},
    ).json()
    check_date = datetime.now(ZoneInfo("America/Sao_Paulo")).date()

    db = context.session_factory()
    try:
        db.add_all(
            [
                HabitCheckIn(habit_id=created["id"], date=check_date),
                HabitCheckIn(habit_id=created["id"], date=check_date),
            ]
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_sqlite_foreign_keys_are_enabled(context):
    with context.engine.connect() as connection:
        enabled = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one()
    assert enabled == 1
