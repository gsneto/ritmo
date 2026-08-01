from icalendar import Calendar


def test_calendar_export_contains_habits_and_unfinished_tasks(
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
    )
    assert habit.status_code == 200

    task = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={
            "name": "Revisar agenda",
            "date": "2026-08-03",
            "time": "18:00",
            "recurrence": "daily",
            "recurrence_interval": 2,
        },
    )
    assert task.status_code == 200

    completed = client.post(
        f"/api/users/{user_id}/tasks",
        headers=auth_headers,
        json={
            "name": "Tarefa já concluída",
            "date": "2026-08-03",
            "time": "19:00",
        },
    ).json()
    assert client.post(
        f"/api/tasks/{completed['id']}/complete",
        headers=auth_headers,
    ).status_code == 200

    response = client.get(
        f"/api/users/{user_id}/export/calendar.ics",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    assert response.headers["content-disposition"].endswith('.ics"')

    calendar = Calendar.from_ical(response.content)
    events = {
        str(component["SUMMARY"]): component
        for component in calendar.walk("VEVENT")
    }
    assert "Hábito: Alongar" in events
    assert events["Hábito: Alongar"]["RRULE"].to_ical() == b"FREQ=WEEKLY;BYDAY=MO,WE,FR"
    assert events["Hábito: Alongar"]["DTSTART"].params["TZID"] == "America/Sao_Paulo"
    assert "Tarefa: Revisar agenda" in events
    assert events["Tarefa: Revisar agenda"]["RRULE"].to_ical() == b"FREQ=DAILY;INTERVAL=2"
    assert "Tarefa: Tarefa já concluída" not in events
