"""shared shopping pairs

Revision ID: b8c19d0a4e32
Revises: 6f24b1d9a021
Create Date: 2026-08-01 08:26:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c19d0a4e32"
down_revision: str | Sequence[str] | None = "6f24b1d9a021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shopping_pairs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("partner_user_id", sa.Integer(), nullable=True),
        sa.Column("invite_code", sa.String(length=12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paired_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "partner_user_id IS NULL OR partner_user_id != owner_user_id",
            name="ck_shopping_pairs_distinct_users",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["partner_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("shopping_pairs") as batch_op:
        batch_op.create_index(batch_op.f("ix_shopping_pairs_id"), ["id"])
        batch_op.create_index(
            batch_op.f("ix_shopping_pairs_invite_code"),
            ["invite_code"],
            unique=True,
        )
        batch_op.create_index(
            batch_op.f("ix_shopping_pairs_owner_user_id"),
            ["owner_user_id"],
            unique=True,
        )
        batch_op.create_index(
            batch_op.f("ix_shopping_pairs_partner_user_id"),
            ["partner_user_id"],
            unique=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("shopping_pairs") as batch_op:
        batch_op.drop_index(batch_op.f("ix_shopping_pairs_partner_user_id"))
        batch_op.drop_index(batch_op.f("ix_shopping_pairs_owner_user_id"))
        batch_op.drop_index(batch_op.f("ix_shopping_pairs_invite_code"))
        batch_op.drop_index(batch_op.f("ix_shopping_pairs_id"))
    op.drop_table("shopping_pairs")
