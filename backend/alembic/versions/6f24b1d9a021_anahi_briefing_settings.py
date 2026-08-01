"""ANAHÍ briefing settings

Revision ID: 6f24b1d9a021
Revises: d755b1cfc868
Create Date: 2026-08-01 08:12:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6f24b1d9a021"
down_revision: str | Sequence[str] | None = "d755b1cfc868"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "briefing_enabled",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "briefing_time",
                sa.Time(),
                server_default=sa.text("'07:30:00'"),
                nullable=False,
            )
        )
    op.create_table(
        "anahi_briefings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("briefing_date", sa.Date(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "briefing_date",
            name="uq_anahi_briefings_user_date",
        ),
    )
    with op.batch_alter_table("anahi_briefings") as batch_op:
        batch_op.create_index("ix_anahi_briefings_created", ["created_at"])
        batch_op.create_index(batch_op.f("ix_anahi_briefings_id"), ["id"])
        batch_op.create_index(batch_op.f("ix_anahi_briefings_user_id"), ["user_id"])


def downgrade() -> None:
    with op.batch_alter_table("anahi_briefings") as batch_op:
        batch_op.drop_index(batch_op.f("ix_anahi_briefings_user_id"))
        batch_op.drop_index(batch_op.f("ix_anahi_briefings_id"))
        batch_op.drop_index("ix_anahi_briefings_created")
    op.drop_table("anahi_briefings")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("briefing_time")
        batch_op.drop_column("briefing_enabled")
