"""durable push worker and active resource guards

Revision ID: f4b7d2a91c03
Revises: b8c19d0a4e32
Create Date: 2026-08-01 21:20:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4b7d2a91c03"
down_revision: str | Sequence[str] | None = "b8c19d0a4e32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _supports_partial_indexes() -> bool:
    return op.get_bind().dialect.name in {"postgresql", "sqlite"}


def _create_push_delivery_user_triggers() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute(
            sa.text(
                "CREATE FUNCTION ritmo_push_delivery_user_guard() "
                "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                "IF TG_OP = 'INSERT' AND (NEW.user_id IS NULL OR NEW.user_id = 0) THEN "
                "SELECT user_id INTO NEW.user_id FROM push_subscriptions "
                "WHERE id = NEW.subscription_id; "
                "IF NEW.status = 'sent' AND NEW.sent_at IS NULL THEN "
                "NEW.sent_at = CURRENT_TIMESTAMP; END IF; "
                "ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN "
                "RAISE EXCEPTION 'push delivery user_id is immutable'; "
                "END IF; RETURN NEW; END $$"
            )
        )
        op.execute(
            sa.text(
                "CREATE TRIGGER trg_push_deliveries_fill_user_id "
                "BEFORE INSERT ON push_deliveries FOR EACH ROW "
                "EXECUTE FUNCTION ritmo_push_delivery_user_guard()"
            )
        )
        op.execute(
            sa.text(
                "CREATE TRIGGER trg_push_deliveries_immutable_user_id "
                "BEFORE UPDATE OF user_id ON push_deliveries FOR EACH ROW "
                "EXECUTE FUNCTION ritmo_push_delivery_user_guard()"
            )
        )
    elif dialect == "sqlite":
        op.execute(
            sa.text(
                "CREATE TRIGGER trg_push_deliveries_fill_user_id "
                "AFTER INSERT ON push_deliveries WHEN NEW.user_id = 0 BEGIN "
                "UPDATE push_deliveries SET user_id = ("
                "SELECT user_id FROM push_subscriptions WHERE id = NEW.subscription_id"
                "), sent_at = CASE WHEN NEW.status = 'sent' "
                "THEN COALESCE(NEW.sent_at, CURRENT_TIMESTAMP) ELSE NEW.sent_at END "
                "WHERE id = NEW.id; END"
            )
        )
        op.execute(
            sa.text(
                "CREATE TRIGGER trg_push_deliveries_immutable_user_id "
                "BEFORE UPDATE OF user_id ON push_deliveries "
                "WHEN OLD.user_id <> 0 AND NEW.user_id <> OLD.user_id BEGIN "
                "SELECT RAISE(ABORT, 'push delivery user_id is immutable'); END"
            )
        )


def _drop_push_delivery_user_triggers() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        op.execute(sa.text("DROP TRIGGER trg_push_deliveries_immutable_user_id"))
        op.execute(sa.text("DROP TRIGGER trg_push_deliveries_fill_user_id"))
    elif dialect == "postgresql":
        op.execute(
            sa.text(
                "DROP TRIGGER trg_push_deliveries_immutable_user_id "
                "ON push_deliveries"
            )
        )
        op.execute(
            sa.text(
                "DROP TRIGGER trg_push_deliveries_fill_user_id ON push_deliveries"
            )
        )
        op.execute(sa.text("DROP FUNCTION ritmo_push_delivery_user_guard()"))


def upgrade() -> None:
    with op.batch_alter_table("push_deliveries") as batch_op:
        batch_op.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(length=16),
                server_default="sent",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "payload",
                sa.Text(),
                server_default="{}",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "attempts",
                sa.Integer(),
                server_default="1",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("last_error", sa.String(length=255), nullable=True)
        )
        batch_op.add_column(
            sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True)
        )

    op.execute(
        sa.text(
            "UPDATE push_deliveries SET user_id = ("
            "SELECT push_subscriptions.user_id FROM push_subscriptions "
            "WHERE push_subscriptions.id = push_deliveries.subscription_id"
            "), attempts = 1, "
            "scheduled_for = created_at, expires_at = created_at, "
            "sent_at = created_at, updated_at = created_at"
        )
    )

    with op.batch_alter_table("push_deliveries") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=16),
            server_default="sent",
            existing_nullable=False,
        )
        batch_op.alter_column(
            "user_id",
            existing_type=sa.Integer(),
            server_default="0",
            nullable=False,
        )
        batch_op.alter_column(
            "scheduled_for",
            existing_type=sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        )
        batch_op.alter_column(
            "expires_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        )
        batch_op.alter_column(
            "updated_at",
            existing_type=sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        )
        batch_op.create_foreign_key(
            "fk_push_deliveries_user_id_users",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_check_constraint(
            "ck_push_deliveries_status",
            "status IN ('pending', 'sent', 'failed')",
        )
        batch_op.create_check_constraint(
            "ck_push_deliveries_attempts_nonnegative",
            "attempts >= 0",
        )

    op.create_index(
        "ix_push_deliveries_user_id",
        "push_deliveries",
        ["user_id"],
    )
    _create_push_delivery_user_triggers()

    # Preserve the newest active row when historical data already violates the
    # invariant, then let the database serialize all future writers.
    op.execute(
        sa.text(
            "UPDATE reading_books SET is_active = false "
            "WHERE is_active = true AND id NOT IN ("
            "SELECT keep_id FROM ("
            "SELECT MAX(id) AS keep_id FROM reading_books "
            "WHERE is_active = true GROUP BY user_id"
            ") AS active_reading_books)"
        )
    )
    op.execute(
        sa.text(
            "UPDATE workout_sessions SET status = 'completed', "
            "completed_at = COALESCE(completed_at, started_at), "
            "duration_seconds = COALESCE(duration_seconds, 0) "
            "WHERE status = 'active' AND id NOT IN ("
            "SELECT keep_id FROM ("
            "SELECT MAX(id) AS keep_id FROM workout_sessions "
            "WHERE status = 'active' GROUP BY user_id"
            ") AS active_workout_sessions)"
        )
    )

    if _supports_partial_indexes():
        dialect = op.get_bind().dialect.name
        predicate_options = (
            {"postgresql_where": sa.text("status = 'pending'")}
            if dialect == "postgresql"
            else {"sqlite_where": sa.text("status = 'pending'")}
        )
        op.create_index(
            "ix_push_deliveries_pending_retry",
            "push_deliveries",
            ["next_retry_at", "id"],
            **predicate_options,
        )
        reading_options = (
            {"postgresql_where": sa.text("is_active")}
            if dialect == "postgresql"
            else {"sqlite_where": sa.text("is_active = 1")}
        )
        op.create_index(
            "uq_reading_books_active_user",
            "reading_books",
            ["user_id"],
            unique=True,
            **reading_options,
        )
        workout_options = (
            {"postgresql_where": sa.text("status = 'active'")}
            if dialect == "postgresql"
            else {"sqlite_where": sa.text("status = 'active'")}
        )
        op.create_index(
            "uq_workout_sessions_active_user",
            "workout_sessions",
            ["user_id"],
            unique=True,
            **workout_options,
        )


def downgrade() -> None:
    _drop_push_delivery_user_triggers()
    op.drop_index("ix_push_deliveries_user_id", table_name="push_deliveries")
    if _supports_partial_indexes():
        op.drop_index(
            "uq_workout_sessions_active_user",
            table_name="workout_sessions",
        )
        op.drop_index(
            "uq_reading_books_active_user",
            table_name="reading_books",
        )
        op.drop_index(
            "ix_push_deliveries_pending_retry",
            table_name="push_deliveries",
        )

    with op.batch_alter_table("push_deliveries") as batch_op:
        batch_op.drop_constraint(
            "ck_push_deliveries_attempts_nonnegative",
            type_="check",
        )
        batch_op.drop_constraint("ck_push_deliveries_status", type_="check")
        batch_op.drop_constraint(
            "fk_push_deliveries_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_column("updated_at")
        batch_op.drop_column("sent_at")
        batch_op.drop_column("expires_at")
        batch_op.drop_column("scheduled_for")
        batch_op.drop_column("last_error")
        batch_op.drop_column("next_retry_at")
        batch_op.drop_column("attempts")
        batch_op.drop_column("payload")
        batch_op.drop_column("status")
        batch_op.drop_column("user_id")
