from models.habit import Habit, HabitCheckIn
from models.reading import ReadingBook
from models.task import Task
from models.workout import Exercise, Workout, WorkoutSession


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
    client.put(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
        json={
            "title": "Livro de teste",
            "current_page": 12,
            "total_pages": 120,
            "notes": "Uma anotação",
        },
    )
    session = client.post(
        f"/api/users/{user_id}/workouts/{replacement.json()[0]['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "reset-workout-session-001",
            "rest_seconds": 60,
        },
    ).json()
    set_id = session["exercises"][0]["sets"][0]["id"]
    client.put(
        f"/api/workout-session-sets/{set_id}",
        headers=auth_headers,
        json={"completed": True, "weight_kg": "6.00", "reps_completed": 10},
    )
    client.post(
        f"/api/workout-sessions/{session['id']}/finish",
        headers=auth_headers,
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
    assert client.get(
        f"/api/users/{user_id}/reading-book",
        headers=auth_headers,
    ).json() is None
    assert client.get(
        f"/api/users/{user_id}/workout-history",
        headers=auth_headers,
    ).json()["total_sessions"] == 0

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
        assert db.query(WorkoutSession).filter_by(user_id=user_id).count() == 0
        assert db.query(ReadingBook).filter_by(user_id=user_id).count() == 0
        assert db.query(HabitCheckIn).count() == 0
        assert (
            db.query(Exercise)
            .join(Workout)
            .filter(Workout.user_id == user_id)
            .count()
            == sum(len(workout["exercises"]) for workout in restored)
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
