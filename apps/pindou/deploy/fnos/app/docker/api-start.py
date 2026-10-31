"""Run migrations and create the default prefix once, then replace with Uvicorn."""
import os
import subprocess
import sys


def main():
    subprocess.run(
        ["alembic", "-c", "/app/apps/api/alembic.ini", "upgrade", "head"], check=True
    )
    from sqlmodel import Session, select
    from pindou.db.session import get_engine, dispose_engine
    from pindou.models.access_key import ApiKeyPrefix

    with Session(get_engine()) as session:
        exists = session.exec(select(ApiKeyPrefix).where(ApiKeyPrefix.code == "fnos")).first()
    dispose_engine()
    if exists is None:
        subprocess.run(
            [sys.executable, "-m", "pindou.cli", "key-prefix", "add", "fnos", "--name", "飞牛 NAS"],
            check=True,
        )
    # An existing disabled prefix is intentionally not re-enabled.
    # Uvicorn's ordinary access log includes query strings; delivery URLs contain keys.
    os.execvp("uvicorn", [
        "uvicorn", "pindou.main:app", "--host", "0.0.0.0", "--port", "3112",
        "--root-path", "", "--no-access-log", "--no-proxy-headers",
    ])


if __name__ == "__main__":
    main()
