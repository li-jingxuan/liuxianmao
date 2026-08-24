"""签发消费密钥的公开 HTTP 模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

SourcePrefix = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z][a-z0-9]{0,31}$", min_length=1, max_length=32),
]
AllowedUses = Annotated[int, Field(strict=True, ge=1, le=1_000_000)]


class AccessKeyCreateRequest(BaseModel):
    prefix: SourcePrefix
    allowed_uses: AllowedUses


class AccessKeyCreateResponse(BaseModel):
    key: str
    prefix: str
    allowed_uses: int
    remaining_uses: int
    created_at: datetime


class AccessKeyQuotaResponse(BaseModel):
    """当前消费密钥的只读额度，不触发扣次。"""

    initial_uses: int = Field(ge=1)
    remaining_uses: int = Field(ge=0)
