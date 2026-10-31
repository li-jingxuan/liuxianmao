"""Configuration initialization, run as root in the API image without networking.

Secrets stay in the mounted configuration directory and are never printed.
Only canonical double-quoted env files are read; nothing is shell-sourced.
"""
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
from urllib.parse import quote


def read_env(path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(".*")', line)
        if not match:
            raise ValueError('配置文件格式无效，请使用生成的双引号 KEY="value" 格式')
        key, value = match.groups()
        if key in values:
            raise ValueError("配置文件含重复字段")
        value = json.loads(value)
        # Compose interpolates double-quoted env values. A literal $ is encoded $$.
        if re.search(r"(?<!\$)\$(?!\$)", value):
            raise ValueError("配置中的字面量美元符号必须写为 $$")
        values[key] = value.replace("$$", "$")
    return values


def write_env(path, values):
    lines = ['# Managed by Pindou fnOS; JSON double quotes, literal $ as $$; never source.\n']
    for key, value in values.items():
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or any(ord(c) < 32 for c in value):
            raise ValueError("配置值不可包含换行或 NUL")
        escaped = json.dumps(value.replace("$", "$$"), ensure_ascii=False)
        lines.append(f"{key}={escaped}\n")
    descriptor, temporary = tempfile.mkstemp(prefix=".pindou-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.writelines(lines)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def database_url(postgres):
    # Passwords, usernames and database names are URL components, never raw SQL.
    user = quote(postgres["POSTGRES_USER"], safe="")
    password = quote(postgres["POSTGRES_PASSWORD"], safe="")
    database = quote(postgres["POSTGRES_DB"], safe="")
    return f"postgresql+psycopg://{user}:{password}@postgres:5432/{database}"


def initialize(config_dir, data_dir, wizard_key="", validate=None, owner=(10001, 10001)):
    config_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    postgres_path = config_dir / "postgres.env"
    api_path = config_dir / "api.env"
    postgres_dir = data_dir / "postgres"
    if postgres_dir.exists() and any(postgres_dir.iterdir()):
        version = postgres_dir / "PG_VERSION"
        if not version.is_file() or version.read_text().strip() != "17":
            raise ValueError("数据库目录非空且不是有效的 PostgreSQL 17 数据，请检查残留或恢复匹配版本的备份")
    postgres = read_env(postgres_path)
    api = read_env(api_path)
    has_postgres_config = bool(postgres)
    has_api_config = bool(api)
    if not has_api_config and (data_dir / "postgres" / "PG_VERSION").exists():
        raise ValueError("发现已有数据库但缺少 api.env，请恢复原管理密钥和哈希 Pepper")
    if has_api_config and not has_postgres_config:
        raise ValueError("postgres.env 缺失：请从备份恢复，禁止自动重建数据库密码")
    if has_postgres_config:
        if not all(postgres.get(key) for key in ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD")):
            raise ValueError("postgres.env 缺少数据库配置，请恢复备份")
    else:
        if (data_dir / "postgres" / "PG_VERSION").exists():
            raise ValueError("发现已有数据库但缺少配置，请恢复 postgres.env 和 api.env")
        postgres = {
            "POSTGRES_DB": "pindou", "POSTGRES_USER": "pindou",
            "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
        }
    url = database_url(postgres)
    if has_api_config:
        if not all(api.get(key) for key in ("DATABASE_URL", "KEY_ISSUER_API_KEY", "API_KEY_HASH_PEPPER")):
            raise ValueError("api.env 缺少已有密钥配置，请恢复备份，禁止自动轮换")
        if api["DATABASE_URL"] != url:
            raise ValueError("数据库凭据不一致：请检查 postgres.env 和 api.env，勿修改已有数据库密码")
    else:
        api = {
            "DATABASE_URL": url,
            "KEY_ISSUER_API_KEY": secrets.token_urlsafe(48),
            "API_KEY_HASH_PEPPER": secrets.token_urlsafe(48),
            "APP_ENV": "production",
            "IMAGE_ENHANCER": "seedream",
            "ARK_DOUBAO_API_KEY": "",
            "ARK_DOUBAO_MAX_CONCURRENCY": "1",
            "IMAGE_DELIVERY_TTL_SECONDS": "604800",
            "IMAGE_DELIVERY_MAX_BYTES": "31457280",
            "IMAGE_DELIVERY_CLEANUP_INTERVAL_SECONDS": "3600",
        }
    if wizard_key:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,512}", wizard_key):
            raise ValueError("方舟 API Key 应为 8–512 位字母、数字或 _ . : -")
        api["ARK_DOUBAO_API_KEY"] = wizard_key
    if not api.get("ARK_DOUBAO_API_KEY"):
        raise ValueError("请在安装向导中填写方舟 API Key")
    if validate:
        validate(api)
    # Validate everything before replacing files. If interrupted after the first
    # write, the next invocation reuses its database password.
    if not has_postgres_config:
        write_env(postgres_path, postgres)
    if not has_api_config or read_env(api_path) != api:
        write_env(api_path, api)
    for path in (postgres_path, api_path):
        path.chmod(0o600)
    for name in ("api-images", "api-logs", "image-deliveries"):
        path = data_dir / name
        path.mkdir(mode=0o750, exist_ok=True)
        if owner is not None:
            os.chown(path, *owner)
    # Official postgres entrypoint sets its own ownership; do not assume its UID.
    (data_dir / "postgres").mkdir(mode=0o700, exist_ok=True)


def main():
    try:
        def validate(values):
            os.environ.update(values)
            from pindou.core.config import Settings
            Settings()

        initialize(Path("/config"), Path("/data"), os.environ.get("wizard_ark_api_key", ""), validate)
    except Exception:
        # Pydantic and other exceptions can embed input values, including secrets.
        print("拼豆配置初始化失败：检查方舟密钥、配置格式、数据库凭据及目录权限；保留现有配置后重试。", flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
