import hashlib
from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from config import get_settings

settings = get_settings()
database_url = settings.database_url


def create_database_engine(url: str, *, echo: bool = False) -> Engine:
    is_sqlite = make_url(url).get_backend_name() == "sqlite"
    database_engine = create_engine(
        url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
        pool_pre_ping=True,
        pool_recycle=3600,
        echo=echo,
    )

    if is_sqlite:
        @event.listens_for(database_engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return database_engine


engine = create_database_engine(database_url, echo=settings.DEBUG)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Iterator[Session]:
    """Dependency for FastAPI routes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_checkin_uniqueness(
    bind: Engine,
    session_factory: sessionmaker,
) -> None:
    """Deduplicate legacy rows and enforce one check-in per habit and date."""
    from models.habit import HabitCheckIn

    db = session_factory()
    try:
        seen: set[tuple[int, object]] = set()
        checkins = db.query(HabitCheckIn).order_by(HabitCheckIn.id).all()
        for checkin in checkins:
            key = (checkin.habit_id, checkin.date)
            if key in seen:
                db.delete(checkin)
            else:
                seen.add(key)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    inspector = inspect(bind)
    target_columns = {"habit_id", "date"}
    constraints = inspector.get_unique_constraints("habit_check_ins")
    indexes = inspector.get_indexes("habit_check_ins")
    uniqueness_exists = any(
        set(item.get("column_names") or []) == target_columns
        for item in [*constraints, *indexes]
        if item.get("unique", True)
    )
    if not uniqueness_exists:
        with bind.begin() as connection:
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX uq_habit_check_ins_habit_date "
                    "ON habit_check_ins (habit_id, date)"
                )
            )


def _ensure_reading_library_schema(bind: Engine) -> None:
    """Upgrade the original one-book SQLite table without discarding its row."""
    if bind.dialect.name != "sqlite":
        return

    inspector = inspect(bind)
    if "reading_books" not in set(inspector.get_table_names()):
        return

    columns = {
        column["name"]
        for column in inspector.get_columns("reading_books")
    }
    unique_user_constraint = any(
        item.get("column_names") == ["user_id"]
        for item in [
            *inspector.get_unique_constraints("reading_books"),
            *inspector.get_indexes("reading_books"),
        ]
        if item.get("unique", True)
    )
    required_columns = {"status", "is_active", "completed_at"}
    needs_rebuild = unique_user_constraint or not required_columns.issubset(columns)

    if needs_rebuild:
        status_expression = (
            "status"
            if "status" in columns
            else (
                "CASE WHEN current_page >= total_pages "
                "THEN 'concluido' ELSE 'lendo' END"
            )
        )
        active_expression = (
            "is_active"
            if "is_active" in columns
            else "CASE WHEN current_page < total_pages THEN 1 ELSE 0 END"
        )
        completed_expression = (
            "completed_at"
            if "completed_at" in columns
            else "CASE WHEN current_page >= total_pages THEN updated_at ELSE NULL END"
        )
        raw_connection = bind.raw_connection()
        cursor = raw_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute("DROP TABLE IF EXISTS reading_books_library_upgrade")
            cursor.execute(
                """
                CREATE TABLE reading_books_library_upgrade (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    current_page INTEGER NOT NULL DEFAULT 0,
                    total_pages INTEGER NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    status VARCHAR(20) NOT NULL DEFAULT 'quero_ler',
                    is_active BOOLEAN NOT NULL DEFAULT 0,
                    completed_at DATETIME,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
                    CONSTRAINT ck_reading_books_current_page_nonnegative
                        CHECK (current_page >= 0),
                    CONSTRAINT ck_reading_books_total_pages_positive
                        CHECK (total_pages > 0),
                    CONSTRAINT ck_reading_books_page_within_total
                        CHECK (current_page <= total_pages),
                    CONSTRAINT ck_reading_books_status
                        CHECK (status IN ('quero_ler', 'lendo', 'concluido'))
                )
                """
            )
            cursor.execute(
                f"""
                INSERT INTO reading_books_library_upgrade (
                    id, user_id, title, current_page, total_pages, notes,
                    status, is_active, completed_at, created_at, updated_at
                )
                SELECT
                    id, user_id, title, current_page, total_pages, notes,
                    {status_expression}, {active_expression},
                    {completed_expression}, created_at, updated_at
                FROM reading_books
                """
            )
            cursor.execute("DROP TABLE reading_books")
            cursor.execute(
                "ALTER TABLE reading_books_library_upgrade RENAME TO reading_books"
            )
            raw_connection.commit()
        except Exception:
            raw_connection.rollback()
            raise
        finally:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
            raw_connection.close()

    with bind.begin() as connection:
        # If a partially migrated database has more than one selected book,
        # preserve the newest selection and make the invariant enforceable.
        connection.execute(
            text(
                "UPDATE reading_books SET is_active = 0 "
                "WHERE is_active = 1 AND id NOT IN ("
                "SELECT MAX(id) FROM reading_books "
                "WHERE is_active = 1 GROUP BY user_id"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_reading_books_active_user "
                "ON reading_books (user_id) WHERE is_active = 1"
            )
        )


def _ensure_shopping_finance_schema(bind: Engine) -> None:
    """Add finance fields to legacy SQLite databases without losing purchases."""
    if bind.dialect.name != "sqlite":
        return

    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())
    if "shopping_lists" not in table_names or "shopping_items" not in table_names:
        return

    list_columns = {
        column["name"]
        for column in inspector.get_columns("shopping_lists")
    }
    item_columns = {
        column["name"]
        for column in inspector.get_columns("shopping_items")
    }
    list_migrations = {
        "category": (
            "ALTER TABLE shopping_lists "
            "ADD COLUMN category VARCHAR(24) NOT NULL DEFAULT 'other'"
        ),
        "budget_cents": (
            "ALTER TABLE shopping_lists ADD COLUMN budget_cents INTEGER"
        ),
        "repeat_enabled": (
            "ALTER TABLE shopping_lists "
            "ADD COLUMN repeat_enabled BOOLEAN NOT NULL DEFAULT 0"
        ),
        "next_list_id": (
            "ALTER TABLE shopping_lists ADD COLUMN next_list_id INTEGER"
        ),
    }
    item_migrations = {
        "quantity": (
            "ALTER TABLE shopping_items "
            "ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1"
        ),
        "unit_price_cents": (
            "ALTER TABLE shopping_items ADD COLUMN unit_price_cents INTEGER"
        ),
    }

    with bind.begin() as connection:
        for column_name, statement in list_migrations.items():
            if column_name not in list_columns:
                connection.execute(text(statement))
        for column_name, statement in item_migrations.items():
            if column_name not in item_columns:
                connection.execute(text(statement))
        connection.execute(
            text(
                "UPDATE shopping_items "
                "SET unit_price_cents = price_cents "
                "WHERE unit_price_cents IS NULL AND price_cents IS NOT NULL"
            )
        )


def _ensure_routine_recurrence_schema(bind: Engine) -> None:
    """Add habit schedules and task recurrence fields without replacing rows."""
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    with bind.begin() as connection:
        if "habits" in table_names:
            habit_columns = {
                column["name"]
                for column in inspector.get_columns("habits")
            }
            if "active_days" not in habit_columns:
                connection.execute(
                    text(
                        "ALTER TABLE habits ADD COLUMN active_days "
                        "VARCHAR(20) NOT NULL DEFAULT '0,1,2,3,4,5,6'"
                    )
                )

        if "tasks" in table_names:
            task_columns = {
                column["name"]
                for column in inspector.get_columns("tasks")
            }
            task_migrations = {
                "recurrence": (
                    "ALTER TABLE tasks ADD COLUMN recurrence "
                    "VARCHAR(12) NOT NULL DEFAULT 'none'"
                ),
                "recurrence_interval": (
                    "ALTER TABLE tasks ADD COLUMN recurrence_interval "
                    "INTEGER NOT NULL DEFAULT 1"
                ),
                "recurrence_parent_id": (
                    "ALTER TABLE tasks ADD COLUMN recurrence_parent_id INTEGER"
                ),
            }
            for column_name, statement in task_migrations.items():
                if column_name not in task_columns:
                    connection.execute(text(statement))

    if "tasks" in table_names:
        refreshed_inspector = inspect(bind)
        indexes = refreshed_inspector.get_indexes("tasks")
        if not any(
            item.get("name") == "ix_tasks_recurrence_parent"
            for item in indexes
        ):
            with bind.begin() as connection:
                connection.execute(
                    text(
                        "CREATE INDEX ix_tasks_recurrence_parent "
                        "ON tasks (recurrence_parent_id)"
                    )
                )


def _ensure_push_subscription_schema(bind: Engine) -> None:
    """Upgrade early local push tables to the portable endpoint-hash index."""
    inspector = inspect(bind)
    if "push_subscriptions" not in set(inspector.get_table_names()):
        return

    columns = {
        column["name"]
        for column in inspector.get_columns("push_subscriptions")
    }
    with bind.begin() as connection:
        if "endpoint_hash" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE push_subscriptions "
                    "ADD COLUMN endpoint_hash VARCHAR(64)"
                )
            )
        rows = connection.execute(
            text("SELECT id, endpoint FROM push_subscriptions")
        ).all()
        for subscription_id, endpoint in rows:
            endpoint_hash = hashlib.sha256(endpoint.encode("utf-8")).hexdigest()
            connection.execute(
                text(
                    "UPDATE push_subscriptions SET endpoint_hash = :endpoint_hash "
                    "WHERE id = :subscription_id"
                ),
                {
                    "endpoint_hash": endpoint_hash,
                    "subscription_id": subscription_id,
                },
            )

    refreshed_inspector = inspect(bind)
    indexes = [
        *refreshed_inspector.get_indexes("push_subscriptions"),
        *refreshed_inspector.get_unique_constraints("push_subscriptions"),
    ]
    if not any(
        set(item.get("column_names") or []) == {"endpoint_hash"}
        and item.get("unique", True)
        for item in indexes
    ):
        with bind.begin() as connection:
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX uq_push_subscriptions_endpoint_hash "
                    "ON push_subscriptions (endpoint_hash)"
                )
            )


def _ensure_push_delivery_schema(bind: Engine) -> None:
    """Keep unversioned local SQLite outboxes compatible with the worker."""
    if bind.dialect.name != "sqlite":
        return
    inspector = inspect(bind)
    if "push_deliveries" not in set(inspector.get_table_names()):
        return

    columns = {
        column["name"]
        for column in inspector.get_columns("push_deliveries")
    }
    migrations = {
        "user_id": "ALTER TABLE push_deliveries ADD COLUMN user_id INTEGER",
        "status": (
            "ALTER TABLE push_deliveries ADD COLUMN status "
            "VARCHAR(16) NOT NULL DEFAULT 'sent'"
        ),
        "payload": (
            "ALTER TABLE push_deliveries ADD COLUMN payload "
            "TEXT NOT NULL DEFAULT '{}'"
        ),
        "attempts": (
            "ALTER TABLE push_deliveries ADD COLUMN attempts "
            "INTEGER NOT NULL DEFAULT 1"
        ),
        "next_retry_at": (
            "ALTER TABLE push_deliveries ADD COLUMN next_retry_at DATETIME"
        ),
        "last_error": (
            "ALTER TABLE push_deliveries ADD COLUMN last_error VARCHAR(255)"
        ),
        "scheduled_for": (
            "ALTER TABLE push_deliveries ADD COLUMN scheduled_for DATETIME"
        ),
        "expires_at": (
            "ALTER TABLE push_deliveries ADD COLUMN expires_at DATETIME"
        ),
        "sent_at": "ALTER TABLE push_deliveries ADD COLUMN sent_at DATETIME",
        "updated_at": (
            "ALTER TABLE push_deliveries ADD COLUMN updated_at DATETIME"
        ),
    }
    with bind.begin() as connection:
        for column_name, statement in migrations.items():
            if column_name not in columns:
                connection.execute(text(statement))
        connection.execute(
            text(
                "UPDATE push_deliveries SET user_id = ("
                "SELECT push_subscriptions.user_id FROM push_subscriptions "
                "WHERE push_subscriptions.id = push_deliveries.subscription_id"
                ") WHERE user_id IS NULL OR user_id = 0"
            )
        )
        connection.execute(
            text(
                "UPDATE push_deliveries SET "
                "attempts = CASE WHEN attempts = 0 THEN 1 ELSE attempts END, "
                "scheduled_for = COALESCE(scheduled_for, created_at), "
                "expires_at = COALESCE(expires_at, created_at), "
                "sent_at = COALESCE(sent_at, created_at), "
                "updated_at = COALESCE(updated_at, created_at) "
                "WHERE status = 'sent'"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_push_deliveries_user_id "
                "ON push_deliveries (user_id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_push_deliveries_pending_retry "
                "ON push_deliveries (next_retry_at, id) WHERE status = 'pending'"
            )
        )
        connection.execute(
            text(
                "CREATE TRIGGER IF NOT EXISTS trg_push_deliveries_fill_user_id "
                "AFTER INSERT ON push_deliveries "
                "WHEN NEW.user_id IS NULL OR NEW.user_id = 0 BEGIN "
                "UPDATE push_deliveries SET "
                "user_id = (SELECT user_id FROM push_subscriptions "
                "WHERE id = NEW.subscription_id), "
                "attempts = CASE WHEN NEW.status = 'sent' AND NEW.attempts = 0 "
                "THEN 1 ELSE NEW.attempts END, "
                "scheduled_for = COALESCE(NEW.scheduled_for, NEW.created_at), "
                "expires_at = COALESCE(NEW.expires_at, NEW.created_at), "
                "sent_at = CASE WHEN NEW.status = 'sent' "
                "THEN COALESCE(NEW.sent_at, NEW.created_at) ELSE NEW.sent_at END, "
                "updated_at = COALESCE(NEW.updated_at, NEW.created_at) "
                "WHERE id = NEW.id; END"
            )
        )
        connection.execute(
            text(
                "CREATE TRIGGER IF NOT EXISTS trg_push_deliveries_immutable_user_id "
                "BEFORE UPDATE OF user_id ON push_deliveries "
                "WHEN OLD.user_id IS NOT NULL AND OLD.user_id <> 0 "
                "AND NEW.user_id <> OLD.user_id BEGIN "
                "SELECT RAISE(ABORT, 'push delivery user_id is immutable'); END"
            )
        )


def _ensure_active_workout_uniqueness(bind: Engine) -> None:
    """Enforce one active workout in unversioned local SQLite databases."""
    if bind.dialect.name != "sqlite":
        return
    inspector = inspect(bind)
    if "workout_sessions" not in set(inspector.get_table_names()):
        return
    with bind.begin() as connection:
        connection.execute(
            text(
                "UPDATE workout_sessions SET status = 'completed', "
                "completed_at = COALESCE(completed_at, started_at), "
                "duration_seconds = COALESCE(duration_seconds, 0) "
                "WHERE status = 'active' AND id NOT IN ("
                "SELECT MAX(id) FROM workout_sessions "
                "WHERE status = 'active' GROUP BY user_id"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_workout_sessions_active_user "
                "ON workout_sessions (user_id) WHERE status = 'active'"
            )
        )


def _ensure_user_briefing_schema(bind: Engine) -> None:
    """Keep pre-Alembic local databases usable after briefing settings ship."""
    inspector = inspect(bind)
    if "users" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    with bind.begin() as connection:
        if "briefing_enabled" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN briefing_enabled "
                    "BOOLEAN NOT NULL DEFAULT false"
                )
            )
        if "briefing_time" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN briefing_time "
                    "TIME NOT NULL DEFAULT '07:30:00'"
                )
            )


def init_db(
    *,
    bind: Engine | None = None,
    session_factory: sessionmaker | None = None,
) -> None:
    """Create missing tables for local/test bootstrap.

    Non-SQLite databases apply versioned schema changes exclusively with
    ``alembic upgrade head``. The compatibility checks below remain only for
    unversioned SQLite databases created by older Ritmo releases and can be
    removed after those databases have been baselined.
    """
    selected_engine = bind or engine
    if selected_engine.dialect.name != "sqlite":
        return

    from models import habit, push, reading, shopping, task, user, workout  # noqa

    selected_session_factory = session_factory or SessionLocal
    _ensure_reading_library_schema(selected_engine)
    Base.metadata.create_all(bind=selected_engine)
    _ensure_reading_library_schema(selected_engine)
    _ensure_shopping_finance_schema(selected_engine)
    _ensure_routine_recurrence_schema(selected_engine)
    _ensure_user_briefing_schema(selected_engine)
    _ensure_push_subscription_schema(selected_engine)
    _ensure_push_delivery_schema(selected_engine)
    _ensure_active_workout_uniqueness(selected_engine)
    _ensure_checkin_uniqueness(selected_engine, selected_session_factory)
