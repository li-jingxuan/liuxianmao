"""Pindou API 的统一启动入口。"""

from __future__ import annotations

import argparse
import sys

import uvicorn
from sqlmodel import Session

from pindou.core.config import get_settings
from pindou.db.session import dispose_engine, get_engine
from pindou.services.access_keys import SOURCE_PREFIX_PATTERN, KeyPrefixService


def main() -> None:
    """启动 API；`key-prefix` 子命令用于受控维护来源前缀。"""
    if len(sys.argv) > 1 and sys.argv[1] == "key-prefix":
        _run_key_prefix_command(sys.argv[2:])
        return

    settings = get_settings()
    uvicorn.run(
        "pindou.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
    )


def _run_key_prefix_command(arguments: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="pindou-api key-prefix")
    subparsers = parser.add_subparsers(dest="operation", required=True)

    add_parser = subparsers.add_parser("add", help="新增来源前缀")
    add_parser.add_argument("code")
    add_parser.add_argument("--name", required=True, dest="display_name")

    for operation in ("enable", "disable"):
        state_parser = subparsers.add_parser(operation, help=f"{operation} 来源前缀")
        state_parser.add_argument("code")

    args = parser.parse_args(arguments)
    if not SOURCE_PREFIX_PATTERN.fullmatch(args.code):
        parser.error("code 必须匹配 ^[a-z][a-z0-9]{0,31}$")

    try:
        with Session(get_engine()) as session:
            service = KeyPrefixService(session)
            if args.operation == "add":
                prefix = service.add(code=args.code, display_name=args.display_name)
            else:
                prefix = service.set_active(args.code, is_active=args.operation == "enable")
    except (RuntimeError, ValueError) as exc:
        parser.error(str(exc))
    finally:
        dispose_engine()
    print(f"{prefix.code}\t{prefix.display_name}\tactive={str(prefix.is_active).lower()}")


if __name__ == "__main__":
    main()
