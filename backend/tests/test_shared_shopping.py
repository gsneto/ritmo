def test_paired_profiles_share_shopping_lists_and_keep_other_domains_private(
    client,
    auth_headers,
):
    users = client.get("/api/users", headers=auth_headers).json()
    owner_id = users[0]["id"]
    partner_id = users[1]["id"]

    owner_list = client.post(
        f"/api/users/{owner_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Compra da casa",
            "kind": "weekly",
            "planned_date": "2026-08-03",
        },
    ).json()
    assert client.get(
        f"/api/users/{partner_id}/shopping-lists",
        headers=auth_headers,
    ).json() == []

    invite_response = client.post(
        f"/api/users/{owner_id}/shopping-share/invite",
        headers=auth_headers,
    )
    assert invite_response.status_code == 200
    invite = invite_response.json()
    assert invite["paired"] is False
    assert len(invite["invite_code"]) == 8

    redeemed = client.post(
        f"/api/users/{partner_id}/shopping-share/redeem",
        headers=auth_headers,
        json={"code": invite["invite_code"].lower()},
    )
    assert redeemed.status_code == 200
    assert redeemed.json()["paired"] is True
    assert redeemed.json()["partner"]["id"] == owner_id

    owner_status = client.get(
        f"/api/users/{owner_id}/shopping-share",
        headers=auth_headers,
    ).json()
    assert owner_status["paired"] is True
    assert owner_status["invite_code"] is None
    assert owner_status["partner"]["id"] == partner_id

    partner_lists = client.get(
        f"/api/users/{partner_id}/shopping-lists",
        headers=auth_headers,
    ).json()
    assert [item["id"] for item in partner_lists] == [owner_list["id"]]

    updated = client.put(
        f"/api/shopping-lists/{owner_list['id']}",
        headers=auth_headers,
        json={"name": "Compra compartilhada"},
    )
    assert updated.status_code == 200
    added_item = client.post(
        f"/api/shopping-lists/{owner_list['id']}/items",
        headers=auth_headers,
        json={"name": "Café", "quantity": 2},
    )
    assert added_item.status_code == 200

    owner_reload = client.get(
        f"/api/users/{owner_id}/shopping-lists",
        headers=auth_headers,
    ).json()
    assert owner_reload[0]["name"] == "Compra compartilhada"
    assert owner_reload[0]["items"][0]["name"] == "Café"

    partner_list = client.post(
        f"/api/users/{partner_id}/shopping-lists",
        headers=auth_headers,
        json={
            "name": "Farmácia",
            "kind": "one_time",
            "planned_date": "2026-08-04",
        },
    ).json()
    owner_list_ids = {
        item["id"]
        for item in client.get(
            f"/api/users/{owner_id}/shopping-lists",
            headers=auth_headers,
        ).json()
    }
    assert owner_list_ids == {owner_list["id"], partner_list["id"]}

    habit = client.post(
        f"/api/users/{owner_id}/habits",
        headers=auth_headers,
        json={"name": "Hábito privado", "time": "07:00"},
    )
    assert habit.status_code == 200
    assert all(
        item["name"] != "Hábito privado"
        for item in client.get(
            f"/api/users/{partner_id}/habits",
            headers=auth_headers,
        ).json()
    )

    task = client.post(
        f"/api/users/{owner_id}/tasks",
        headers=auth_headers,
        json={
            "name": "Tarefa privada",
            "date": "2026-08-03",
            "time": "10:00",
        },
    )
    assert task.status_code == 200
    assert all(
        item["name"] != "Tarefa privada"
        for item in client.get(
            f"/api/users/{partner_id}/tasks",
            headers=auth_headers,
        ).json()
    )

    reading = client.put(
        f"/api/users/{owner_id}/reading-book",
        headers=auth_headers,
        json={
            "title": "Livro privado",
            "current_page": 10,
            "total_pages": 100,
            "notes": "",
        },
    )
    assert reading.status_code == 200
    assert client.get(
        f"/api/users/{partner_id}/reading-books",
        headers=auth_headers,
    ).json() == []

    partner_workouts = client.get(
        f"/api/users/{partner_id}/workouts",
        headers=auth_headers,
    ).json()
    assert partner_workouts
    assert all(item["user_id"] == partner_id for item in partner_workouts)


def test_shopping_share_rejects_invalid_or_conflicting_invites(
    client,
    auth_headers,
):
    users = client.get("/api/users", headers=auth_headers).json()
    owner_id = users[0]["id"]
    partner_id = users[1]["id"]

    invalid = client.post(
        f"/api/users/{partner_id}/shopping-share/redeem",
        headers=auth_headers,
        json={"code": "INVALID2"},
    )
    assert invalid.status_code == 404

    invite = client.post(
        f"/api/users/{owner_id}/shopping-share/invite",
        headers=auth_headers,
    ).json()
    own_invite = client.post(
        f"/api/users/{owner_id}/shopping-share/redeem",
        headers=auth_headers,
        json={"code": invite["invite_code"]},
    )
    assert own_invite.status_code == 409

    assert client.delete(
        f"/api/users/{owner_id}/shopping-share",
        headers=auth_headers,
    ).json() == {
        "paired": False,
        "invite_code": None,
        "partner": None,
    }
