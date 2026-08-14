"""Create API key prefix and quota tables.

Revision ID: 20260814_0001
Revises:
Create Date: 2026-08-14
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260814_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INITIAL_WEB_PREFIX_ID = UUID("a90ab2a4-ddd2-4cbd-a816-46f481112460")


def upgrade() -> None:
    op.create_table(
        "api_key_prefixes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_api_key_prefixes_code"),
    )
    op.create_index("ix_api_key_prefixes_code", "api_key_prefixes", ["code"])
    op.create_table(
        "api_access_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key_hash", sa.LargeBinary(length=32), nullable=False),
        sa.Column("prefix_id", sa.Uuid(), nullable=False),
        sa.Column("key_preview", sa.String(length=48), nullable=False),
        sa.Column("initial_uses", sa.Integer(), nullable=False),
        sa.Column("remaining_uses", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exhausted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "initial_uses > 0", name="ck_api_access_keys_initial_uses_positive"
        ),
        sa.CheckConstraint(
            "remaining_uses >= 0", name="ck_api_access_keys_remaining_uses_nonnegative"
        ),
        sa.CheckConstraint(
            "remaining_uses <= initial_uses",
            name="ck_api_access_keys_remaining_not_above_initial",
        ),
        sa.ForeignKeyConstraint(["prefix_id"], ["api_key_prefixes.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key_hash", name="uq_api_access_keys_key_hash"),
    )

    prefixes = sa.table(
        "api_key_prefixes",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String()),
        sa.column("display_name", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    now = datetime(2026, 8, 14, tzinfo=UTC)
    op.bulk_insert(
        prefixes,
        [
            {
                "id": INITIAL_WEB_PREFIX_ID,
                "code": "web",
                "display_name": "Web",
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
        ],
        multiinsert=False,
    )


def downgrade() -> None:
    op.drop_table("api_access_keys")
    op.drop_index("ix_api_key_prefixes_code", table_name="api_key_prefixes")
    op.drop_table("api_key_prefixes")
