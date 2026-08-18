"""来源前缀管理、密钥生成和次数消费领域服务。"""

from __future__ import annotations

import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlmodel import Session

from pindou.core.errors import ApiError
from pindou.models.access_key import ApiAccessKey, ApiKeyPrefix
from pindou.repositories.access_keys import AccessKeyRepository, KeyPrefixRepository

MAX_KEY_LENGTH = 96
KEY_GENERATION_ATTEMPTS = 3
SOURCE_PREFIX_PATTERN = re.compile(r"^[a-z][a-z0-9]{0,31}$")


@dataclass(frozen=True, slots=True)
class IssuedAccessKey:
    key: str
    prefix: str
    allowed_uses: int
    remaining_uses: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class QuotaUsage:
    initial_uses: int
    remaining_uses: int


class AccessKeyService:
    """协调 ORM 仓储，但不向 HTTP 层泄漏表模型。"""

    def __init__(self, session: Session, *, hash_pepper: str) -> None:
        self._session = session
        self._hash_pepper = hash_pepper.encode("utf-8")
        self._prefixes = KeyPrefixRepository(session)
        self._keys = AccessKeyRepository(session)

    def issue(self, *, prefix_code: str, allowed_uses: int) -> IssuedAccessKey:
        try:
            prefix = self._prefixes.get_active(prefix_code)
        except SQLAlchemyError as exc:
            self._session.rollback()
            raise _database_unavailable() from exc
        if prefix is None:
            raise ApiError(400, "KEY_PREFIX_INVALID", "密钥来源前缀不存在或已停用")

        for _ in range(KEY_GENERATION_ATTEMPTS):
            secret = secrets.token_urlsafe(32)
            plaintext = f"pdk_{prefix.code}_{secret}"
            model = ApiAccessKey(
                key_hash=self.hash_key(plaintext),
                prefix_id=prefix.id,
                key_preview=f"pdk_{prefix.code}_{secret[:4]}...",
                initial_uses=allowed_uses,
                remaining_uses=allowed_uses,
            )
            try:
                stored = self._keys.add(model)
            except IntegrityError:
                continue
            except SQLAlchemyError as exc:
                self._session.rollback()
                raise _database_unavailable() from exc
            return IssuedAccessKey(
                key=plaintext,
                prefix=prefix.code,
                allowed_uses=stored.initial_uses,
                remaining_uses=stored.remaining_uses,
                created_at=stored.created_at,
            )
        raise ApiError(500, "API_KEY_GENERATION_FAILED", "生成密钥失败，请稍后重试")

    def consume(self, plaintext_key: str | None, *, request_id: str) -> QuotaUsage:
        if not plaintext_key or len(plaintext_key) > MAX_KEY_LENGTH:
            raise _invalid_access_key()
        try:
            usage = self._keys.consume(
                self.hash_key(plaintext_key),
                request_id=request_id,
                operation="conversion",
            )
        except SQLAlchemyError as exc:
            self._session.rollback()
            raise _database_unavailable() from exc
        if usage is None:
            raise _invalid_access_key()
        return QuotaUsage(
            initial_uses=usage.initial_uses,
            remaining_uses=usage.remaining_uses,
        )

    def hash_key(self, plaintext_key: str) -> bytes:
        return hmac.digest(self._hash_pepper, plaintext_key.encode("utf-8"), "sha256")


class KeyPrefixService:
    """供受控 CLI 和未来管理 API 复用的前缀管理入口。"""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._prefixes = KeyPrefixRepository(session)

    def add(self, *, code: str, display_name: str) -> ApiKeyPrefix:
        if not SOURCE_PREFIX_PATTERN.fullmatch(code):
            raise ValueError("前缀必须匹配 ^[a-z][a-z0-9]{0,31}$")
        if not 1 <= len(display_name) <= 100:
            raise ValueError("前缀展示名长度必须在 1 到 100 之间")
        try:
            if self._prefixes.get(code) is not None:
                raise ValueError(f"前缀 {code} 已存在")
            return self._prefixes.add(code=code, display_name=display_name)
        except SQLAlchemyError as exc:
            self._session.rollback()
            raise RuntimeError("数据库操作失败") from exc

    def set_active(self, code: str, *, is_active: bool) -> ApiKeyPrefix:
        try:
            prefix = self._prefixes.set_active(code, is_active=is_active)
        except SQLAlchemyError as exc:
            self._session.rollback()
            raise RuntimeError("数据库操作失败") from exc
        if prefix is None:
            raise ValueError(f"前缀 {code} 不存在")
        return prefix


def _invalid_access_key() -> ApiError:
    return ApiError(
        401,
        "API_KEY_INVALID_OR_EXHAUSTED",
        # API Key 无效或可用次数已耗尽
        "API Key 无效或可用次数已耗尽",
        headers={"WWW-Authenticate": "ApiKey"},
    )


def _database_unavailable() -> ApiError:
    return ApiError(503, "DATABASE_UNAVAILABLE", "数据库暂时不可用，请稍后重试")
