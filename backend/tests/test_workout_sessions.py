from datetime import timedelta
from decimal import Decimal

from models.workout import (
    WorkoutExercisePreference,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSetLog,
)


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


def test_empty_session_can_be_discarded_and_finished_session_stops_at_last_set(
    context,
    client,
    auth_headers,
    user_id,
):
    workout = _first_trainable_workout(client, auth_headers, user_id)

    empty_started = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-discard-empty",
            "rest_seconds": 60,
        },
    )
    assert empty_started.status_code == 200
    empty_session = empty_started.json()

    discarded = client.delete(
        f"/api/workout-sessions/{empty_session['id']}",
        headers=auth_headers,
    )
    assert discarded.status_code == 204
    assert discarded.content == b""

    active = client.get(
        f"/api/users/{user_id}/workout-sessions/active",
        headers=auth_headers,
    )
    assert active.status_code == 200
    assert active.json() is None

    db = context.session_factory()
    try:
        assert db.query(WorkoutSession).filter_by(id=empty_session["id"]).first() is None
        assert (
            db.query(WorkoutSessionExercise)
            .filter_by(session_id=empty_session["id"])
            .count()
            == 0
        )
    finally:
        db.close()

    started = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-stale-duration",
            "rest_seconds": 60,
        },
    )
    assert started.status_code == 200
    session = started.json()
    set_id = session["exercises"][0]["sets"][0]["id"]

    completed_set = client.put(
        f"/api/workout-session-sets/{set_id}",
        headers=auth_headers,
        json={"completed": True, "weight_kg": "8.00", "reps_completed": 10},
    )
    assert completed_set.status_code == 200

    cannot_discard_completed_session = client.delete(
        f"/api/workout-sessions/{session['id']}",
        headers=auth_headers,
    )
    assert cannot_discard_completed_session.status_code == 409

    expected_duration_seconds = 37 * 60 + 9
    db = context.session_factory()
    try:
        stored_session = db.query(WorkoutSession).filter_by(id=session["id"]).one()
        stored_set = db.query(WorkoutSetLog).filter_by(id=set_id).one()
        stale_started_at = stored_session.started_at - timedelta(hours=51)
        stored_session.started_at = stale_started_at
        stored_set.completed_at = stale_started_at + timedelta(
            seconds=expected_duration_seconds
        )
        db.commit()
    finally:
        db.close()

    finished = client.post(
        f"/api/workout-sessions/{session['id']}/finish",
        headers=auth_headers,
    )
    assert finished.status_code == 200
    assert finished.json()["duration_seconds"] == expected_duration_seconds


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


def test_exercise_progression_records_suggestions_and_preferences(
    context,
    client,
    auth_headers,
    user_id,
):
    workout = _first_trainable_workout(client, auth_headers, user_id)
    first_exercise = workout["exercises"][0]

    started = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-progression-first",
            "rest_seconds": 60,
        },
    )
    assert started.status_code == 200
    first_session = started.json()
    first_session_exercise = first_session["exercises"][0]
    initial_progress = first_session_exercise["progress"]
    assert initial_progress["suggestion_action"] == "start"
    assert initial_progress["last_weight_kg"] is None
    assert initial_progress["rest_seconds"] == 60
    assert Decimal(initial_progress["increment_kg"]) == Decimal("1.00")

    target_reps = int(first_session_exercise["planned_reps"])
    for set_log in first_session_exercise["sets"]:
        response = client.put(
            f"/api/workout-session-sets/{set_log['id']}",
            headers=auth_headers,
            json={
                "completed": True,
                "weight_kg": "8.00",
                "reps_completed": target_reps,
            },
        )
        assert response.status_code == 200

    finished = client.post(
        f"/api/workout-sessions/{first_session['id']}/finish",
        headers=auth_headers,
    )
    assert finished.status_code == 200

    history = client.get(
        f"/api/users/{user_id}/workout-history",
        headers=auth_headers,
    )
    assert history.status_code == 200
    progress = next(
        item
        for item in history.json()["exercise_progress"]
        if item["exercise_name"] == first_exercise["name"]
    )
    assert progress["suggestion_action"] == "increase"
    assert Decimal(progress["last_weight_kg"]) == Decimal("8.00")
    assert progress["last_reps_completed"] == target_reps
    assert progress["last_completed_sets"] == first_session_exercise["target_sets"]
    assert Decimal(progress["personal_record_weight_kg"]) == Decimal("8.00")
    assert Decimal(progress["suggested_weight_kg"]) == Decimal("9.00")
    assert len(progress["last_sets"]) == first_session_exercise["target_sets"]
    assert len(progress["evolution"]) == 1

    saved_preference = client.put(
        f"/api/users/{user_id}/workout-exercise-preference",
        headers=auth_headers,
        json={
            "exercise_name": first_exercise["name"],
            "rest_seconds": 90,
            "increment_kg": "0.50",
        },
    )
    assert saved_preference.status_code == 200
    preference_progress = saved_preference.json()
    assert preference_progress["rest_seconds"] == 90
    assert Decimal(preference_progress["increment_kg"]) == Decimal("0.50")
    assert Decimal(preference_progress["suggested_weight_kg"]) == Decimal("8.50")

    second_started = client.post(
        f"/api/users/{user_id}/workouts/{workout['id']}/sessions",
        headers=auth_headers,
        json={
            "idempotency_key": "workout-progression-second",
            "rest_seconds": 60,
        },
    )
    assert second_started.status_code == 200
    second_session = second_started.json()
    second_exercise = second_session["exercises"][0]
    assert second_exercise["progress"]["rest_seconds"] == 90
    assert Decimal(
        second_exercise["progress"]["suggested_weight_kg"]
    ) == Decimal("8.50")

    incomplete_set = second_exercise["sets"][0]
    completed = client.put(
        f"/api/workout-session-sets/{incomplete_set['id']}",
        headers=auth_headers,
        json={
            "completed": True,
            "weight_kg": "8.50",
            "reps_completed": max(1, target_reps - 1),
        },
    )
    assert completed.status_code == 200
    second_finished = client.post(
        f"/api/workout-sessions/{second_session['id']}/finish",
        headers=auth_headers,
    )
    assert second_finished.status_code == 200

    evolved = client.get(
        f"/api/users/{user_id}/workout-history",
        headers=auth_headers,
    ).json()
    progress = next(
        item
        for item in evolved["exercise_progress"]
        if item["exercise_name"] == first_exercise["name"]
    )
    assert progress["suggestion_action"] == "maintain"
    assert Decimal(progress["suggested_weight_kg"]) == Decimal("8.50")
    assert Decimal(progress["personal_record_weight_kg"]) == Decimal("8.50")
    assert len(progress["evolution"]) == 2
    assert [point["session_id"] for point in progress["evolution"]] == [
        first_session["id"],
        second_session["id"],
    ]

    db = context.session_factory()
    try:
        preference = db.query(WorkoutExercisePreference).one()
        assert preference.rest_seconds == 90
        assert preference.increment_kg == Decimal("0.50")
        assert db.query(WorkoutSession).filter_by(status="completed").count() == 2
    finally:
        db.close()


def test_exercise_preference_validation_and_security(
    client,
    auth_headers,
    user_id,
):
    payload = {
        "exercise_name": "Agachamento goblet",
        "rest_seconds": 90,
        "increment_kg": "1.00",
    }
    unauthorized = client.put(
        f"/api/users/{user_id}/workout-exercise-preference",
        json=payload,
    )
    assert unauthorized.status_code == 401

    invalid_rest = client.put(
        f"/api/users/{user_id}/workout-exercise-preference",
        headers=auth_headers,
        json={**payload, "rest_seconds": 10},
    )
    assert invalid_rest.status_code == 422

    invalid_increment = client.put(
        f"/api/users/{user_id}/workout-exercise-preference",
        headers=auth_headers,
        json={**payload, "increment_kg": "20.25"},
    )
    assert invalid_increment.status_code == 422

    missing_user = client.put(
        "/api/users/999999/workout-exercise-preference",
        headers=auth_headers,
        json=payload,
    )
    assert missing_user.status_code == 404
