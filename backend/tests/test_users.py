def test_seeded_users_and_profile_validation(client, auth_headers):
    response = client.get("/api/users", headers=auth_headers)
    assert response.status_code == 200
    users = response.json()
    assert [user["profile_id"] for user in users] == ["antonio", "itayna"]

    user_id = users[0]["id"]
    updated = client.put(
        f"/api/users/{user_id}",
        headers=auth_headers,
        json={"name": "  Antonio Teste  ", "initials": "AT", "theme": "dark"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Antonio Teste"
    assert updated.json()["theme"] == "dark"

    invalid_theme = client.put(
        f"/api/users/{user_id}/theme",
        headers=auth_headers,
        json={"theme": "blue"},
    )
    assert invalid_theme.status_code == 422

    blank_name = client.put(
        f"/api/users/{user_id}",
        headers=auth_headers,
        json={"name": "   "},
    )
    assert blank_name.status_code == 422

    unexpected = client.put(
        f"/api/users/{user_id}",
        headers=auth_headers,
        json={"unknown": "value"},
    )
    assert unexpected.status_code == 422
