"""通用结构化事件日志落盘，不感知任何具体业务领域。"""

from __future__ import annotations

import json
import math
import re
import time
from collections.abc import Mapping
from pathlib import Path
from secrets import token_hex

type JSONScalar = str | int | float | bool | None
type JSONValue = JSONScalar | list[JSONValue] | dict[str, JSONValue]

_EVENT_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_RESERVED_FIELDS = frozenset({"event", "timestamp_ms"})


def _normalize_json_value(value: object, *, path: str) -> JSONValue:
    """递归验证并拷贝 JSON 值，禁止隐式 `str()` 泄露任意对象内容。"""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{path} 必须是有限浮点数")
        return value
    if isinstance(value, list):
        return [
            _normalize_json_value(item, path=f"{path}[{index}]")
            for index, item in enumerate(value)
        ]
    if isinstance(value, Mapping):
        normalized: dict[str, JSONValue] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{path} 的键必须是字符串")
            normalized[key] = _normalize_json_value(item, path=f"{path}.{key}")
        return normalized
    raise TypeError(f"{path} 包含不支持的 JSON 类型: {type(value).__name__}")


def write_event_log(
    event: str,
    payload: Mapping[str, object],
    *,
    directory: Path,
) -> Path:
    """以独立 JSON 文件写入一次事件，并返回实际落盘路径。"""
    if not _EVENT_PATTERN.fullmatch(event):
        raise ValueError("event 必须匹配 ^[a-z][a-z0-9_]{0,63}$")
    reserved = _RESERVED_FIELDS.intersection(payload)
    if reserved:
        raise ValueError(f"payload 不得覆盖保留字段: {', '.join(sorted(reserved))}")

    normalized = _normalize_json_value(payload, path="payload")
    if not isinstance(normalized, dict):  # Mapping 根节理论上始终为 dict。
        raise TypeError("payload 必须是字符串键映射")

    timestamp_ms = time.time_ns() // 1_000_000
    document: dict[str, JSONValue] = {
        "event": event,
        "timestamp_ms": timestamp_ms,
        **normalized,
    }
    content = json.dumps(
        document,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")

    directory.mkdir(parents=True, exist_ok=True)
    # 随机后缀避免同毫秒并发事件冲突；`xb` 在极端碰撞时仍保证不覆盖。
    while True:
        path = directory / f"{timestamp_ms}-{token_hex(4)}-{event}.json"
        try:
            with path.open("xb") as output:
                output.write(content)
        except FileExistsError:
            continue
        return path
