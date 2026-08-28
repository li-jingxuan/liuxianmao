from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from pindou.api import dependencies
from pindou.core.config import FOREGROUND_MODEL_ARTIFACTS, Settings
from pindou.imaging.foreground import ForegroundMaskAdapter


def _settings(**overrides: Any) -> Settings:
    """构造不依赖本地 .env 的模型配置。"""
    values: dict[str, Any] = {
        "app_env": "test",
        "image_enhancer": "passthrough",
        "enable_onnx_matting": True,
        "foreground_mask_adapter": "onnx",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_default_foreground_model_is_full_u2net() -> None:
    settings = _settings()

    assert settings.foreground_model_variant == "u2net"
    assert settings.foreground_model_artifact == FOREGROUND_MODEL_ARTIFACTS["u2net"]
    assert settings.foreground_model_artifact.model_path.name == "u2net.onnx"
    assert settings.foreground_model_artifact.metadata_path.name == "u2net.json"


def test_foreground_model_variant_normalizes_and_selects_u2netp() -> None:
    settings = _settings(foreground_model_variant=" U2NETP ")

    assert settings.foreground_model_variant == "u2netp"
    assert settings.foreground_model_artifact.model_path.name == "u2netp.onnx"
    assert settings.foreground_model_artifact.metadata_path.name == "u2netp.json"


def test_invalid_foreground_model_variant_is_rejected() -> None:
    with pytest.raises(ValueError, match="FOREGROUND_MODEL_VARIANT"):
        _settings(foreground_model_variant="unknown")


@pytest.mark.parametrize("variant", ["u2net", "u2netp"])
def test_dependency_constructs_selected_model(
    monkeypatch: pytest.MonkeyPatch,
    variant: str,
) -> None:
    captured: dict[str, Any] = {}

    class _SelectedAdapter:
        name = variant
        model_version = "test"
        ready = True

        def generate(self, image: Any) -> Any:  # pragma: no cover - 本测试只验证装配。
            raise AssertionError("generate should not be called")

    def construct_adapter(**kwargs: Any) -> ForegroundMaskAdapter:
        captured.update(kwargs)
        return _SelectedAdapter()

    monkeypatch.setattr(dependencies, "get_settings", lambda: _settings(
        foreground_model_variant=variant
    ))
    monkeypatch.setattr(dependencies, "OnnxForegroundMaskAdapter", construct_adapter)
    dependencies.get_foreground_mask_adapter.cache_clear()
    try:
        selected = dependencies.get_foreground_mask_adapter()
    finally:
        dependencies.get_foreground_mask_adapter.cache_clear()

    artifact = FOREGROUND_MODEL_ARTIFACTS[variant]
    assert selected.name == variant
    assert captured["model_path"] == artifact.model_path
    assert captured["metadata_path"] == artifact.metadata_path
    assert captured["expected_model_name"] == variant
    assert isinstance(captured["model_path"], Path)
