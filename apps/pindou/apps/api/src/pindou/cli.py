"""Pindou API 的统一启动入口。"""

from __future__ import annotations

import uvicorn

from pindou.core.config import get_settings


def main() -> None:
    """按 `.env` 配置启动 Uvicorn，默认允许通过宿主机 IP 访问。"""
    settings = get_settings()
    uvicorn.run(
        "pindou.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
    )


if __name__ == "__main__":
    main()
