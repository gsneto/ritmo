from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

from database import create_database_engine, init_db


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
    assert task["recurrence"] == "none"
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


def test_recurring_task_creates_and_reopens_next_occurrence(
    client,
    auth_headers,
    user_id,
):
    created = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={
            "name": "Fechar o mês",
            "date": "2026-01-31",
            "time": "18:00",
            "recurrence": "monthly",
        },
    )
    assert created.status_code == 200
    task_id = created.json()["id"]

    completed = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=auth_headers,
    )
    assert completed.status_code == 200

    listed = client.get(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
    ).json()
    assert len(listed) == 2
    generated = next(task for task in listed if task["id"] != task_id)
    assert generated["date"] == "2026-02-28"
    assert generated["recurrence"] == "monthly"
    assert generated["recurrence_parent_id"] == task_id

    reopened = client.post(
        f"/api/tasks/{task_id}/complete",
        headers=auth_headers,
    )
    assert reopened.status_code == 200
    assert reopened.json()["completed_at"] is None
    listed_after_reopen = client.get(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
    ).json()
    assert [task["id"] for task in listed_after_reopen] == [task_id]


def test_task_recurrence_validation(client, auth_headers, user_id):
    invalid = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={
            "name": "Inválida",
            "date": "2026-07-29",
            "time": "10:00",
            "recurrence": "yearly",
        },
    )
    assert invalid.status_code == 422


def test_legacy_routine_schema_is_upgraded_without_losing_rows(tmp_path):
    engine = create_database_engine(
        f"sqlite:///{(tmp_path / 'legacy-routine.db').as_posix()}"
    )
    legacy_session = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE users ("
                "id INTEGER PRIMARY KEY, profile_id VARCHAR(50) NOT NULL, "
                "name VARCHAR(100) NOT NULL, initials VARCHAR(3) NOT NULL, "
                "theme VARCHAR(5), created_at DATETIME)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE habits ("
                "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
                "name VARCHAR(200) NOT NULL, time TIME NOT NULL, "
                "created_at DATE NOT NULL)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE tasks ("
                "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
                "name VARCHAR(200) NOT NULL, date DATE NOT NULL, "
                "time TIME NOT NULL, completed_at DATETIME, "
                "created_at DATE NOT NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO users VALUES "
                "(1, 'antonio', 'Antonio', 'A', 'light', CURRENT_TIMESTAMP)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO habits VALUES "
                "(7, 1, 'Água', '08:00', '2026-07-29')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO tasks VALUES "
                "(9, 1, 'Conta', '2026-07-30', '18:00', NULL, '2026-07-29')"
            )
        )

    init_db(bind=engine, session_factory=legacy_session)

    inspector = inspect(engine)
    assert "active_days" in {
        column["name"] for column in inspector.get_columns("habits")
    }
    assert {
        "recurrence",
        "recurrence_interval",
        "recurrence_parent_id",
    }.issubset({
        column["name"] for column in inspector.get_columns("tasks")
    })
    with engine.connect() as connection:
        habit_row = connection.execute(
            text("SELECT id, name, active_days FROM habits WHERE id = 7")
        ).one()
        task_row = connection.execute(
            text(
                "SELECT id, name, recurrence, recurrence_interval "
                "FROM tasks WHERE id = 9"
            )
        ).one()
    assert tuple(habit_row) == (7, "Água", "0,1,2,3,4,5,6")
    assert tuple(task_row) == (9, "Conta", "none", 1)
    engine.dispose()
