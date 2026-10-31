"""NAS 恢复带特殊字符的数据库凭据时，迁移配置必须保持原始 URL。"""

from io import StringIO
from pathlib import Path
from types import SimpleNamespace

from alembic import command
from alembic.config import Config
from pydantic import SecretStr


def test_offline_migrations_accept_url_encoded_password(monkeypatch):
    url = "postgresql+psycopg://pindou:fake%40password%25%2F@postgres:5432/pindou"
    monkeypatch.setattr(
        "pindou.core.config.get_settings",
        lambda: SimpleNamespace(database_url=SecretStr(url)),
    )
    output = StringIO()
    config = Config(output_buffer=output)
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
    )

    # sql=True generates PostgreSQL DDL without connecting to any database.
    command.upgrade(config, "head", sql=True)

    assert config.get_main_option("sqlalchemy.url") == url
    assert "CREATE TABLE" in output.getvalue()
