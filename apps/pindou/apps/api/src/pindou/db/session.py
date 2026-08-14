"""集中管理 SQLModel Engine 和请求级同步 Session。"""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, literal, select
from sqlmodel import Session, create_engine

from pindou.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """按当前配置创建进程级连接池，不在模块导入阶段建立连接。"""
    configured_url = get_settings().database_url
    if configured_url is None:
        raise RuntimeError("DATABASE_URL is required")
    database_url = configured_url.get_secret_value()
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


def get_session() -> Iterator[Session]:
    """为单次请求提供 Session，并确保异常路径释放数据库连接。"""
    with Session(get_engine()) as session:
        yield session


def check_database(session: Session) -> None:
    """使用 SQLAlchemy 表达式验证数据库连接，不执行手写 SQL。"""
    session.exec(select(literal(1))).one()


def dispose_engine() -> None:
    """关闭当前连接池，并允许测试或重载进程重新读取数据库配置。"""
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()

