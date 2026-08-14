from __future__ import annotations

import os
import secrets
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from pindou.core.errors import ApiError
from pindou.models import ApiAccessKey, ApiKeyPrefix, ApiKeyUsage
from pindou.services.access_keys import AccessKeyService, KeyPrefixService

POSTGRES_URL = os.getenv("TEST_POSTGRES_URL")


@pytest.mark.postgres
@pytest.mark.skipif(not POSTGRES_URL, reason="TEST_POSTGRES_URL is not configured")
def test_postgres_concurrent_consumption_never_exceeds_quota() -> None:
    """真实 PostgreSQL 中 50 个并发消费者最多成功扣减 10 次。"""
    assert POSTGRES_URL is not None
    engine = create_engine(POSTGRES_URL, pool_size=20, max_overflow=30)
    SQLModel.metadata.create_all(engine)
    prefix_code = f"pg{secrets.token_hex(6)}"
    pepper = secrets.token_urlsafe(32)

    with Session(engine) as session:
        prefix = KeyPrefixService(session).add(
            code=prefix_code,
            display_name="PostgreSQL concurrency test",
        )
        issued = AccessKeyService(session, hash_pepper=pepper).issue(
            prefix_code=prefix.code,
            allowed_uses=10,
        )
        key_hash = AccessKeyService(session, hash_pepper=pepper).hash_key(issued.key)

    def consume_once(index: int) -> bool:
        with Session(engine) as worker_session:
            try:
                AccessKeyService(worker_session, hash_pepper=pepper).consume(
                    issued.key,
                    request_id=f"req_postgres_{index}",
                )
            except ApiError as exc:
                assert exc.code == "API_KEY_INVALID_OR_EXHAUSTED"
                return False
            return True

    try:
        with ThreadPoolExecutor(max_workers=50) as executor:
            results = list(executor.map(consume_once, range(50)))

        assert sum(results) == 10
        with Session(engine) as session:
            stored = session.exec(
                select(ApiAccessKey).where(ApiAccessKey.key_hash == key_hash)
            ).one()
            assert stored.remaining_uses == 0
            history = session.exec(
                select(ApiKeyUsage).where(ApiKeyUsage.access_key_id == stored.id)
            ).all()
            assert len(history) == 10
            assert sorted(item.remaining_uses_after for item in history) == list(range(10))
    finally:
        with Session(engine) as session:
            stored_key = session.exec(
                select(ApiAccessKey).where(ApiAccessKey.key_hash == key_hash)
            ).one_or_none()
            stored_prefix = session.exec(
                select(ApiKeyPrefix).where(ApiKeyPrefix.code == prefix_code)
            ).one_or_none()
            if stored_key is not None:
                usages = session.exec(
                    select(ApiKeyUsage).where(ApiKeyUsage.access_key_id == stored_key.id)
                ).all()
                for usage in usages:
                    session.delete(usage)
                session.commit()
                session.delete(stored_key)
                session.commit()
            if stored_prefix is not None:
                session.delete(stored_prefix)
                session.commit()
        engine.dispose()
