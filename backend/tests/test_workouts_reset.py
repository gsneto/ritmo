from models.habit import Habit, HabitCheckIn
from models.task import Task
from models.workout import Exercise, Workout


def test_workout_replacement_validation_and_safe_reset(
    context,
    client,
    auth_headers,
    user_id,
):
    seeded = client.get(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
    )
    assert seeded.status_code == 200
    assert len(seeded.json()) == 7

    invalid = client.put(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
        json={"workouts": [{"day": "Monday", "title": "Treino", "exercises": []}]},
    )
    assert invalid.status_code == 422

    replacement = client.put(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
        json={
            "workouts": [
                {
                    "day": "Seg",
                    "title": "Força",
                    "note": "Controlado",
                    "exercises": [
                        {"name": "Supino", "sets": "3", "reps": "10"},
                    ],
                }
            ]
        },
    )
    assert replacement.status_code == 200
    assert len(replacement.json()) == 1
    assert replacement.json()[0]["exercises"][0]["name"] == "Supino"

    habit = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "Leitura", "time": "21:00"},
    ).json()
    client.post(
        f"/api/habits/{habit['id']}/checkin",
        headers=auth_headers,
        json={"date": habit["created_at"]},
    )
    client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={"name": "Planejar", "date": habit["created_at"], "time": "20:00"},
    )

    reset = client.delete(f"/api/users/{user_id}/data", headers=auth_headers)
    assert reset.status_code == 200
    assert client.get(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
    ).json() == []
    assert client.get(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
    ).json() == []

    restored = client.get(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
    ).json()
    assert len(restored) == 7

    db = context.session_factory()
    try:
        assert db.query(Habit).filter(Habit.user_id == user_id).count() == 0
        assert db.query(Task).filter(Task.user_id == user_id).count() == 0
        assert db.query(Workout).filter(Workout.user_id == user_id).count() == 7
        assert db.query(HabitCheckIn).count() == 0
        assert (
            db.query(Exercise)
            .join(Workout)
            .filter(Workout.user_id == user_id)
            .count()
            == 9
        )
        assert (
            db.query(Exercise)
            .outerjoin(Workout)
            .filter(Workout.id.is_(None))
            .count()
            == 0
        )
    finally:
        db.close()
