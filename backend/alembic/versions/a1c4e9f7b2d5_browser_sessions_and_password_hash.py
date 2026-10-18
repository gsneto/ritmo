"""browser sessions and profile password hashes

Revision ID: a1c4e9f7b2d5
Revises: f4b7d2a91c03
Create Date: 2026-10-17 16:10:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c4e9f7b2d5"
down_revision: str | Sequence[str] | None = "f4b7d2a91c03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("password_hash", sa.String(length=255), nullable=True)
        )

    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
    )
    with op.batch_alter_table("user_sessions") as batch_op:
        batch_op.create_index("ix_user_sessions_user_id", ["user_id"])
        batch_op.create_index("ix_user_sessions_expires_at", ["expires_at"])


def downgrade() -> None:
    with op.batch_alter_table("user_sessions") as batch_op:
        batch_op.drop_index("ix_user_sessions_expires_at")
        batch_op.drop_index("ix_user_sessions_user_id")
    op.drop_table("user_sessions")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("password_hash")
