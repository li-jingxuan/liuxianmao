"""Alembic migration environment bound to the application Settings."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from pindou.core.config import get_settings
from pindou.models import ApiAccessKey, ApiKeyPrefix  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

configured_url = get_settings().database_url
if configured_url is None:
    raise RuntimeError("DATABASE_URL is required")
# ConfigParser 使用 % 插值；URL 编码的特殊字符须先转义，读取时恢复原 URL。
config.set_main_option("sqlalchemy.url", configured_url.get_secret_value().replace("%", "%%"))
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
