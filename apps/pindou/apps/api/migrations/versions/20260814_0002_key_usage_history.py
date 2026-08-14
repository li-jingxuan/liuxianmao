"""Add API key consumption history and align table prefixes.

Revision ID: 20260814_0002
Revises: 20260814_0001
Create Date: 2026-08-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260814_0002"
down_revision: str | None = "20260814_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 0001 已可能部署，使用新 revision 重命名而不是改写迁移历史。
    op.rename_table("api_key_prefixes", "tb_api_key_prefixes")
    op.rename_table("api_access_keys", "tb_api_access_keys")
    op.drop_index("ix_api_key_prefixes_code", table_name="tb_api_key_prefixes")
    op.create_index(
        "ix_tb_api_key_prefixes_code",
        "tb_api_key_prefixes",
        ["code"],
    )
    op.create_table(
        "tb_api_key_usages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("access_key_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("remaining_uses_after", sa.Integer(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "remaining_uses_after >= 0",
            name="ck_api_key_usages_remaining_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["access_key_id"],
            ["tb_api_access_keys.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_api_key_usages_access_key_consumed_at",
        "tb_api_key_usages",
        ["access_key_id", "consumed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_api_key_usages_access_key_consumed_at",
        table_name="tb_api_key_usages",
    )
    op.drop_table("tb_api_key_usages")
    op.drop_index("ix_tb_api_key_prefixes_code", table_name="tb_api_key_prefixes")
    op.create_index("ix_api_key_prefixes_code", "tb_api_key_prefixes", ["code"])
    op.rename_table("tb_api_access_keys", "api_access_keys")
    op.rename_table("tb_api_key_prefixes", "api_key_prefixes")
