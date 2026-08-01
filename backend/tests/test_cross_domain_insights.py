from datetime import UTC, datetime, time, timedelta

from models.habit import Habit, HabitCheckIn
from models.reading import ReadingBook, ReadingSession
from models.task import Task
from models.workout import WorkoutSession
from time_utils import app_today


def test_insights_are_hidden_before_minimum_history(client, auth_headers, user_id):
    response = client.get(
        f"/api/users/{user_id}/stats/insights",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["history_days"] < 14
    assert response.json()["insights"] == []


def test_insights_connect_habits_workouts_tasks_and_reading(
    context,
    auth_headers,
    user_id,
):
    today = app_today()
    start = today - timedelta(days=27)
    with context.session_factory() as db:
        habit = Habit(
            user_id=user_id,
            name="Rotina da manhã",
            time=time(7, 0),
            active_days="0,1,2,3,4,5,6",
            created_at=start,
        )
        db.add(habit)
        db.flush()

        done_offsets = {0, 2, 4, 6, 8, 10, 12, 14}
        training_offsets = {0, 4, 8, 12}
        for offset in done_offsets:
            db.add(HabitCheckIn(habit_id=habit.id, date=start + timedelta(days=offset)))
        for offset in training_offsets:
            workout_date = start + timedelta(days=offset)
            completed_at = datetime.combine(
                workout_date,
                time(19, 0),
                tzinfo=UTC,
            )
            db.add(
                WorkoutSession(
                    user_id=user_id,
                    workout_title="Treino em casa",
                    workout_day="Seg",
                    status="completed",
                    rest_seconds=60,
                    started_at=completed_at - timedelta(minutes=30),
                    completed_at=completed_at,
                    duration_seconds=1800,
                    revision=0,
                )
            )

        for offset in (0, 7, 14, 21):
            task_date = start + timedelta(days=offset)
            db.add(
                Task(
                    user_id=user_id,
                    name=f"Tarefa {offset}",
                    date=task_date,
                    time=time(9, 0),
                    completed_at=datetime.combine(task_date, time(10, 0)),
                    recurrence="none",
                    recurrence_interval=1,
                    created_at=task_date,
                )
            )

        book = ReadingBook(
            user_id=user_id,
            title="Livro de teste",
            current_page=0,
            total_pages=300,
            notes="",
            status="lendo",
            is_active=True,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(book)
        db.flush()
        for index, offset in enumerate((0, 2, 4, 6, 1, 3, 5, 7)):
            session_date = start + timedelta(days=offset)
            db.add(
                ReadingSession(
                    book_id=book.id,
                    session_date=session_date,
                    start_page=index * 5,
                    end_page=(index + 1) * 5,
                    duration_minutes=20 if offset in done_offsets else 5,
                    source="manual",
                    created_at=datetime.now(UTC),
                )
            )
        db.commit()

    response = context.client.get(
        f"/api/users/{user_id}/stats/insights",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["history_days"] == 28
    by_key = {insight["key"]: insight for insight in payload["insights"]}
    assert set(by_key) == {
        "habit_training_days",
        "best_task_weekday",
        "reading_morning_habits",
    }
    assert "100%" in by_key["habit_training_days"]["description"]
    assert "associação" in by_key["habit_training_days"]["description"]
    assert "4" in by_key["best_task_weekday"]["description"]
    assert "10 min" in by_key["reading_morning_habits"]["description"]
