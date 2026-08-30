from __future__ import annotations

import re
from pathlib import Path

import pytest

from pindou.core.config import Settings

ENV_EXAMPLE_PATH = Path(__file__).resolve().parents[1] / ".env.example"
ENV_ASSIGNMENT_PATTERN = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
CHINESE_CHARACTER_PATTERN = re.compile(r"[\u4e00-\u9fff]")


def _settings_environment_keys() -> set[str]:
    """从 Settings 字段生成其实际读取的环境变量名。"""
    keys: set[str] = set()
    for field_name, field in Settings.model_fields.items():
        validation_alias = field.validation_alias
        keys.add(validation_alias if isinstance(validation_alias, str) else field_name.upper())
    return keys


def _example_assignments() -> list[tuple[int, str, str]]:
    """返回示例文件中的行号、变量名和值。"""
    assignments: list[tuple[int, str, str]] = []
    example_lines = ENV_EXAMPLE_PATH.read_text(encoding="utf-8").splitlines()
    for line_number, line in enumerate(example_lines, 1):
        match = ENV_ASSIGNMENT_PATTERN.fullmatch(line)
        if match:
            assignments.append((line_number, match.group(1), match.group(2)))
    return assignments


def test_env_example_covers_every_runtime_setting_once() -> None:
    assignments = _example_assignments()
    example_keys = [key for _, key, _ in assignments]

    assert set(example_keys) == _settings_environment_keys()
    assert len(example_keys) == len(set(example_keys))


def test_every_env_example_value_has_an_adjacent_chinese_comment() -> None:
    lines = ENV_EXAMPLE_PATH.read_text(encoding="utf-8").splitlines()

    for line_number, key, value in _example_assignments():
        assert value.strip(), f"{key} 缺少示例值"
        preceding_line = lines[line_number - 2] if line_number >= 2 else ""
        assert preceding_line.startswith("# "), f"{key} 缺少紧邻注释"
        assert CHINESE_CHARACTER_PATTERN.search(preceding_line), f"{key} 缺少中文注释"


def test_env_example_can_be_loaded_as_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in _settings_environment_keys():
        monkeypatch.delenv(key, raising=False)

    settings = Settings(_env_file=ENV_EXAMPLE_PATH)

    assert settings.app_env == "development"
    assert settings.image_enhancer == "seedream"
    assert settings.foreground_model_variant == "u2net"
