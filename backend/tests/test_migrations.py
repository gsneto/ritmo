from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from config import get_settings


def test_legacy_push_delivery_insert_remains_valid_after_migration(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "legacy-push-migration.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("APP_ACCESS_TOKEN", "migration-test-token")
    monkeypatch.setenv("RITMO_DEBUG", "false")
    get_settings.cache_clear()
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))

    try:
        command.upgrade(config, "b8c19d0a4e32")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (profile_id, name, initials, theme) "
                    "VALUES ('migration-user', 'Migration', 'MG', 'light')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO push_subscriptions ("
                    "user_id, endpoint, endpoint_hash, p256dh, auth, enabled, "
                    "created_at, updated_at) VALUES ("
                    "1, 'https://push.example/legacy', :endpoint_hash, "
                    "'abcdefgh', 'abcdefgh', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"endpoint_hash": "a" * 64},
            )
            connection.execute(
                text(
                    "INSERT INTO push_deliveries ("
                    "subscription_id, reminder_key, created_at) "
                    "VALUES (1, 'before-migration', CURRENT_TIMESTAMP)"
                )
            )
        engine.dispose()

        command.upgrade(config, "head")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO push_deliveries ("
                    "subscription_id, reminder_key, created_at) "
                    "VALUES (1, 'legacy-api-after-migration', CURRENT_TIMESTAMP)"
                )
            )
            rows = connection.execute(
                text(
                    "SELECT reminder_key, user_id, status, payload, attempts, "
                    "scheduled_for, expires_at, sent_at, updated_at "
                    "FROM push_deliveries ORDER BY id"
                )
            ).mappings().all()

        assert [row["reminder_key"] for row in rows] == [
            "before-migration",
            "legacy-api-after-migration",
        ]
        assert all(row["user_id"] == 1 for row in rows)
        assert all(row["status"] == "sent" for row in rows)
        assert all(row["payload"] == "{}" for row in rows)
        assert all(row["attempts"] == 1 for row in rows)
        assert all(
            row[column] is not None
            for row in rows
            for column in ("scheduled_for", "expires_at", "sent_at", "updated_at")
        )
        columns = {
            column["name"]: column
            for column in inspect(engine).get_columns("push_deliveries")
        }
        assert columns["user_id"]["nullable"] is False
        assert any(
            index["name"] == "ix_push_deliveries_user_id"
            for index in inspect(engine).get_indexes("push_deliveries")
        )
        engine.dispose()
    finally:
        get_settings.cache_clear()
