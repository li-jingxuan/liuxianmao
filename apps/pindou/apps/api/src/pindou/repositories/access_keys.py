"""通过 ORM 模型操作来源前缀和消费密钥。"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import case, func, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from pindou.models.access_key import ApiAccessKey, ApiKeyPrefix, ApiKeyUsage, utc_now


@dataclass(frozen=True, slots=True)
class StoredQuotaUsage:
    """原子扣减后由数据库返回的余额。"""

    initial_uses: int
    remaining_uses: int


class KeyPrefixRepository:
    """封装来源前缀的 ORM 查询和状态变更。"""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_active(self, code: str) -> ApiKeyPrefix | None:
        statement = select(ApiKeyPrefix).where(
            ApiKeyPrefix.code == code,
            ApiKeyPrefix.is_active.is_(True),
        )
        return self._session.exec(statement).one_or_none()

    def get(self, code: str) -> ApiKeyPrefix | None:
        return self._session.exec(
            select(ApiKeyPrefix).where(ApiKeyPrefix.code == code)
        ).one_or_none()

    def add(self, *, code: str, display_name: str) -> ApiKeyPrefix:
        prefix = ApiKeyPrefix(code=code, display_name=display_name)
        self._session.add(prefix)
        self._session.commit()
        self._session.refresh(prefix)
        return prefix

    def set_active(self, code: str, *, is_active: bool) -> ApiKeyPrefix | None:
        prefix = self.get(code)
        if prefix is None:
            return None
        prefix.is_active = is_active
        prefix.updated_at = utc_now()
        self._session.add(prefix)
        self._session.commit()
        self._session.refresh(prefix)
        return prefix


class AccessKeyRepository:
    """封装消费密钥创建和并发安全扣次。"""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, access_key: ApiAccessKey) -> ApiAccessKey:
        self._session.add(access_key)
        try:
            self._session.commit()
        except IntegrityError:
            self._session.rollback()
            raise
        self._session.refresh(access_key)
        return access_key

    def consume(
        self,
        key_hash: bytes,
        *,
        request_id: str,
        operation: str,
    ) -> StoredQuotaUsage | None:
        """在同一事务中完成条件扣减和追加消费历史。"""
        statement = (
            update(ApiAccessKey)
            .where(
                ApiAccessKey.key_hash == key_hash,
                ApiAccessKey.remaining_uses > 0,
            )
            .values(
                remaining_uses=ApiAccessKey.remaining_uses - 1,
                last_used_at=func.now(),
                exhausted_at=case(
                    (ApiAccessKey.remaining_uses == 1, func.now()),
                    else_=ApiAccessKey.exhausted_at,
                ),
            )
            .returning(
                ApiAccessKey.id,
                ApiAccessKey.initial_uses,
                ApiAccessKey.remaining_uses,
            )
        )
        row = self._session.execute(statement).one_or_none()
        if row is None:
            self._session.commit()
            return None
        self._session.add(
            ApiKeyUsage(
                access_key_id=row[0],
                request_id=request_id,
                operation=operation,
                remaining_uses_after=row[2],
            )
        )
        # UPDATE 与 INSERT 共用当前事务；历史写入失败时扣次也会回滚。
        self._session.commit()
        return StoredQuotaUsage(initial_uses=row[1], remaining_uses=row[2])
