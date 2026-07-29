from datetime import datetime
from zoneinfo import ZoneInfo


def test_stats_use_real_checkins_and_correct_weekday(client, auth_headers, user_id):
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    habit = client.post(
        f"/api/users/{user_id}/habits",
        headers=auth_headers,
        json={"name": "Alongar", "time": "07:00"},
    ).json()
    checked = client.post(
        f"/api/habits/{habit['id']}/checkin",
        headers=auth_headers,
        json={"date": today.isoformat()},
    )
    assert checked.status_code == 200

    today_stats = client.get(
        f"/api/users/{user_id}/stats/today",
        headers=auth_headers,
    )
    assert today_stats.status_code == 200
    assert today_stats.json()["today_progress"] == "100%"
    assert today_stats.json()["checked_count"] == "1 de 1 feitos"
    assert today_stats.json()["habits_today"][0]["done"] is True

    week = client.get(
        f"/api/users/{user_id}/stats/week",
        headers=auth_headers,
    )
    weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
    assert week.status_code == 200
    assert week.json()["days"][-1] == {
        "day": weekdays[today.weekday()],
        "percent": 100,
        "done": 1,
        "total": 1,
    }

    streak = client.get(
        f"/api/users/{user_id}/stats/streak",
        headers=auth_headers,
    )
    assert streak.status_code == 200
    assert streak.json()["streak"] == 1

    monthly = client.get(
        f"/api/users/{user_id}/stats/monthly",
        headers=auth_headers,
    )
    assert monthly.status_code == 200
    assert monthly.json()["months"][-1]["month"] == [
        "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
        "Jul", "Ago", "Set", "Out", "Nov", "Dez",
    ][today.month - 1]
    assert monthly.json()["months"][-1]["score"] == 100


def test_stats_reject_unknown_user(client, auth_headers):
    assert client.get(
        "/api/users/999999/stats/today",
        headers=auth_headers,
    ).status_code == 404
