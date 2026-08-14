"""API Key 来源和次数配额的 SQLModel 表模型。"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, Index, LargeBinary, UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """生成带时区的 UTC 时间。"""
    return datetime.now(UTC)


class ApiKeyPrefix(SQLModel, table=True):
    """可动态维护的密钥来源前缀。"""

    __tablename__ = "tb_api_key_prefixes"
    __table_args__ = (UniqueConstraint("code", name="uq_api_key_prefixes_code"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    code: str = Field(min_length=1, max_length=32, index=True)
    display_name: str = Field(min_length=1, max_length=100)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ApiAccessKey(SQLModel, table=True):
    """只保存消费密钥摘要、来源关系和剩余次数。"""

    __tablename__ = "tb_api_access_keys"
    __table_args__ = (
        UniqueConstraint("key_hash", name="uq_api_access_keys_key_hash"),
        CheckConstraint("initial_uses > 0", name="ck_api_access_keys_initial_uses_positive"),
        CheckConstraint(
            "remaining_uses >= 0", name="ck_api_access_keys_remaining_uses_nonnegative"
        ),
        CheckConstraint(
            "remaining_uses <= initial_uses",
            name="ck_api_access_keys_remaining_not_above_initial",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    key_hash: bytes = Field(sa_column=Column(LargeBinary(32), nullable=False))
    prefix_id: UUID = Field(
        foreign_key="tb_api_key_prefixes.id",
        nullable=False,
        ondelete="RESTRICT",
    )
    key_preview: str = Field(min_length=1, max_length=48)
    initial_uses: int = Field(gt=0)
    remaining_uses: int = Field(ge=0)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    exhausted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class ApiKeyUsage(SQLModel, table=True):
    """每次成功扣减产生一条不可变的消费审计记录。"""

    __tablename__ = "tb_api_key_usages"
    __table_args__ = (
        CheckConstraint(
            "remaining_uses_after >= 0",
            name="ck_api_key_usages_remaining_nonnegative",
        ),
        Index(
            "ix_api_key_usages_access_key_consumed_at",
            "access_key_id",
            "consumed_at",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    access_key_id: UUID = Field(
        foreign_key="tb_api_access_keys.id",
        nullable=False,
        ondelete="RESTRICT",
    )
    request_id: str = Field(min_length=1, max_length=128)
    operation: str = Field(min_length=1, max_length=32)
    remaining_uses_after: int = Field(ge=0)
    consumed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
