from decimal import Decimal

from models.workout import WorkoutSession, WorkoutSessionExercise, WorkoutSetLog


def _first_trainable_workout(client, auth_headers, user_id):
    response = client.get(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
    )
    assert response.status_code == 200
    return next(workout for workout in response.json() if workout["exercises"])


def test_guided_workout_flow_is_idempotent_and_keeps_history_snapshot(
    context,
    client,
    auth_headers,
    user_id,
):
    workout = _first_trainable_workout(client, auth_headers, user_id)
    start_payload = {
        "idempotency_key": "workout-session-flow-001",
        "rest_seconds": 75,
    }

    started = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json=start_payload,
    )
    assert started.status_code == 200
    session = started.json()
    assert session["status"] == "active"
    assert session["workout_title"] == workout["title"]
    assert session["rest_seconds"] == 75
    assert session["total_sets"] >= 1
    assert session["completed_sets"] == 0

    repeated_start = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json=start_payload,
    )
    assert repeated_start.status_code == 200
    assert repeated_start.json()["id"] == session["id"]

    second_active = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-session-flow-002",
            "rest_seconds": 60,
        },
    )
    assert second_active.status_code == 409

    set_id = session["exercises"][0]["sets"][0]["id"]
    invalid_precision = client.put(
        f"/api/workout-session-sets/{set_id}",
        headers=auth_headers,
        json={"completed": True, "weight_kg": "8.255", "reps_completed": 10},
    )
    assert invalid_precision.status_code == 422

    completed_set = client.put(
        f"/api/workout-session-sets/{set_id}",
        headers=auth_headers,
        json={"completed": True, "weight_kg": "8.50", "reps_completed": 10},
    )
    assert completed_set.status_code == 200
    session = completed_set.json()
    assert session["completed_sets"] == 1
    assert Decimal(session["max_weight_kg"]) == Decimal("8.50")
    assert Decimal(session["total_volume_kg"]) == Decimal("85.00")

    # Retrying the same completion neither duplicates a set nor changes totals.
    repeated_set = client.put(
        f"/api/workout-session-sets/{set_id}",
        headers=auth_headers,
        json={"completed": True, "weight_kg": "8.50", "reps_completed": 10},
    )
    assert repeated_set.status_code == 200
    assert repeated_set.json()["completed_sets"] == 1
    assert Decimal(repeated_set.json()["total_volume_kg"]) == Decimal("85.00")

    replacement = client.put(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
        json={
            "workouts": [
                {
                    "day": "Seg",
                    "title": "Novo plano caseiro",
                    "note": "Somente halteres",
                    "exercises": [
                        {
                            "name": "Agachamento goblet",
                            "sets": "4",
                            "reps": "10",
                        }
                    ],
                }
            ]
        },
    )
    assert replacement.status_code == 200

    snapshotted = client.get(
        f"/api/workout-sessions/{session['id']}",
        headers=auth_headers,
    )
    assert snapshotted.status_code == 200
    assert snapshotted.json()["workout_id"] is None
    assert snapshotted.json()["workout_title"] == workout["title"]
    assert snapshotted.json()["exercises"][0]["name"] == workout["exercises"][0]["name"]

    finished = client.post(
        f"/api/workout-sessions/{session['id']}/finish",
        headers=auth_headers,
    )
    assert finished.status_code == 200
    final_session = finished.json()
    assert final_session["status"] == "completed"
    assert final_session["completed_sets"] == 1
    assert final_session["duration_seconds"] >= 0
    completed_at = final_session["completed_at"]

    repeated_finish = client.post(
        f"/api/workout-sessions/{session['id']}/finish",
        headers=auth_headers,
    )
    assert repeated_finish.status_code == 200
    assert repeated_finish.json()["completed_at"] == completed_at

    locked = client.put(
        f"/api/workout-session-sets/{set_id}",
        headers=auth_headers,
        json={"completed": False},
    )
    assert locked.status_code == 409

    active = client.get(
        f"/api/users/{user_id}/workout-sessions/active",
        headers=auth_headers,
    )
    assert active.status_code == 200
    assert active.json() is None

    history = client.get(
        f"/api/users/{user_id}/workout-history",
        headers=auth_headers,
    )
    assert history.status_code == 200
    summary = history.json()
    assert summary["total_sessions"] == 1
    assert summary["completed_sets"] == 1
    assert Decimal(summary["total_volume_kg"]) == Decimal("85.00")
    assert summary["sessions"][0]["workout_title"] == workout["title"]

    db = context.session_factory()
    try:
        persisted = db.query(WorkoutSession).filter_by(id=session["id"]).one()
        assert persisted.workout_id is None
        assert persisted.status == "completed"
        assert (
            db.query(WorkoutSessionExercise)
            .filter_by(session_id=session["id"])
            .count()
            == len(session["exercises"])
        )
        logged = db.query(WorkoutSetLog).filter_by(id=set_id).one()
        assert logged.weight_kg == Decimal("8.50")
    finally:
        db.close()


def test_workout_session_validation_and_security(
    client,
    auth_headers,
    user_id,
):
    workout = _first_trainable_workout(client, auth_headers, user_id)

    unauthorized = client.get(
        f"/api/users/{user_id}/workout-history",
    )
    assert unauthorized.status_code == 401

    invalid_rest = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-invalid-rest",
            "rest_seconds": 5,
        },
    )
    assert invalid_rest.status_code == 422

    empty_plan = client.put(
        f"/api/users/{user_id}/workouts",
        headers=auth_headers,
        json={
            "workouts": [
                {
                    "day": "Seg",
                    "title": "Descanso",
                    "exercises": [],
                }
            ]
        },
    )
    assert empty_plan.status_code == 200
    empty_workout_id = empty_plan.json()[0]["id"]

    cannot_start_empty = client.post(
        f"/api/users/{user_id}/workouts/{empty_workout_id}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-empty-plan",
            "rest_seconds": 60,
        },
    )
    assert cannot_start_empty.status_code == 400

    missing_user = client.get(
        "/api/users/999999/workout-history",
        headers=auth_headers,
    )
    assert missing_user.status_code == 404
