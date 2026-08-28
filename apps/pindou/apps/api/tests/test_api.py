from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import make_png_bytes
from fastapi.testclient import TestClient
from PIL import Image

from pindou.api.dependencies import (
    get_color_chart,
    get_foreground_mask_adapter,
    get_image_enhancer,
    provide_settings,
)
from pindou.api.routes import conversions as conversions_route
from pindou.core.config import Settings
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import RawForegroundMask
from pindou.main import app
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import BackgroundHint, EnhancementOptions, EnhancementResult


class FakeAiEnhancer:
    name = "seedream-5-lite"
    model = "fake-model"
    prompt_version = "fake-prompt"
    last_options: EnhancementOptions | None = None
    supported_styles = frozenset(ConversionStyle)

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        type(self).last_options = options
        return EnhancementResult(
            image=Image.new("RGBA", image.size, (0, 0, 255, 255)),
            background_hint=(
                BackgroundHint("chroma_key", (0, 255, 0), "solid-chroma-v1")
                if options.background_hint_kind == "chroma_key"
                else None
            ),
        )


class FakeSolidEnhancer:
    """模拟 Seedream 返回平坦键色背景，Solid 最终 Alpha 由 ONNX 蒙版负责。"""

    name = "passthrough"
    model = None
    prompt_version = None
    supported_styles = frozenset(ConversionStyle)

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        assert options.background_mode is BackgroundMode.SOLID
        assert options.background_hint_kind == "chroma_key"
        output = Image.new("RGBA", image.size, (0, 255, 0, 255))
        for x in range(image.width // 4, image.width - image.width // 4):
            for y in range(image.height // 4, image.height - image.height // 4):
                output.putpixel((x, y), (255, 255, 255, 255))
        return EnhancementResult(
            image=output,
            background_hint=BackgroundHint("chroma_key", (0, 255, 0), "solid-chroma-v1"),
        )


class FakeChromaDegradedEnhancer:
    """模拟只有顶边遵循键色的 Seedream 输出，稳定触发完整验证降级。"""

    name = "seedream-5-lite"
    model = "test-model"
    prompt_version = "test-chroma"
    supported_styles = frozenset(ConversionStyle)

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        assert options.background_hint_kind == "chroma_key"
        output = Image.new("RGBA", image.size, (220, 30, 30, 255))
        for x in range(image.width):
            output.putpixel((x, 0), (0, 255, 0, 255))
        return EnhancementResult(
            image=output,
            background_hint=BackgroundHint(
                kind="chroma_key",
                requested_color=(0, 255, 0),
                policy_version="solid-chroma-v1",
            ),
        )


class ConstantForegroundMaskAdapter:
    name = "test-constant"
    model_version = "test-v1"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        return RawForegroundMask(
            Image.new("L", image.size, 255),
            self.name,
            self.model_version,
        )


def test_healthcheck(client: TestClient) -> None:
    """健康检查返回固定契约，并为响应附加 request ID。"""
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"].startswith("req_")


def test_cors_allows_any_origin_and_preflight_request(client: TestClient) -> None:
    """任意网站/IP 的浏览器预检请求都可以调用公开 API。"""
    response = client.options(
        "/api/v1/conversions",
        headers={
            "Origin": "https://example-client.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-request-id",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers


def test_cors_exposes_request_id_to_browser(client: TestClient) -> None:
    """跨域前端可读取排障所需的 x-request-id 响应头。"""
    response = client.get(
        "/healthz",
        headers={"Origin": "http://192.168.1.20:3111"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    exposed_headers = {
        item.strip() for item in response.headers["access-control-expose-headers"].split(",")
    }
    assert exposed_headers == {
        "x-request-id",
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
    }


def test_list_color_sets_comes_from_chart(client: TestClient) -> None:
    """颜色组选项必须与源色卡一致，不能来自路由内另一份硬编码成员清单。"""
    response = client.get("/api/v1/color-sets")

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.0"
    assert payload["default_size"] == 264
    assert [item["size"] for item in payload["sets"]] == [
        24,
        48,
        72,
        96,
        120,
        144,
        168,
        192,
        216,
        221,
        264,
    ]
    assert all(item["size"] == item["color_count"] for item in payload["sets"])


def test_list_colors_returns_complete_catalog_grouped_by_series(client: TestClient) -> None:
    """全量色卡只公开展示字段，并保持系列与颜色的自然顺序。"""
    response = client.get("/api/v1/colors")

    assert response.status_code == 200
    payload = response.json()
    assert payload["brand"] == "MARD"
    assert payload["schema_version"] == "1.0"
    assert payload["total_count"] == 291
    assert [group["series"] for group in payload["groups"]] == [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "M",
        "P",
        "Q",
        "R",
        "T",
        "Y",
        "ZG",
    ]
    assert [group["color_count"] for group in payload["groups"]] == [
        26,
        32,
        29,
        26,
        24,
        25,
        21,
        23,
        15,
        23,
        5,
        28,
        1,
        5,
        8,
    ]

    colors = [color for group in payload["groups"] for color in group["colors"]]
    assert len(colors) == payload["total_count"]
    assert len({color["code"] for color in colors}) == payload["total_count"]
    assert colors[0] == {
        "code": "A1",
        "hex": "#F9F0CD",
        "rgb": [249, 240, 205],
    }
    assert colors[-1]["code"] == "ZG8"
    assert all(set(color) == {"code", "hex", "rgb"} for color in colors)

    assert [color_set["size"] for color_set in payload["sets"]] == [
        24,
        48,
        72,
        96,
        120,
        144,
        168,
        192,
        216,
        221,
        264,
    ]
    for color_set in payload["sets"]:
        assert color_set["label"] == f"MARD {color_set['size']}色套装"
        assert color_set["color_count"] == color_set["size"]
        assert len(color_set["colors"]) == color_set["size"]
        assert all(set(color) == {"code", "hex", "rgb"} for color in color_set["colors"])

    set_24 = next(color_set for color_set in payload["sets"] if color_set["size"] == 24)
    set_221 = next(color_set for color_set in payload["sets"] if color_set["size"] == 221)
    set_264 = next(color_set for color_set in payload["sets"] if color_set["size"] == 264)
    assert {color["code"] for color in set_24["colors"]} < {
        color["code"] for color in set_264["colors"]
    }
    assert {color["code"] for color in set_221["colors"]} != {
        color["code"] for color in set_264["colors"]
    }


@pytest.mark.parametrize("grid_size", [8, 52, 78, 104, 156])
@pytest.mark.parametrize("color_set_size", [24, 48, 264])
def test_create_conversion_returns_grid_restricted_to_selected_set(
    client: TestClient,
    grid_size: int,
    color_set_size: int,
) -> None:
    """覆盖自定义边界、三个预设和代表颜色组，并验证组内色号不变量。"""
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": str(grid_size),
            "max_colors": "8",
            "color_set_size": str(color_set_size),
            "conversion_style": "original",
            "background_mode": "keep",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["width"] == payload["height"] == grid_size
    assert len(payload["foreground"]["rows"]) == grid_size
    assert all(len(row) == grid_size for row in payload["foreground"]["rows"])
    assert payload["schema_version"] == "4"
    assert payload["algorithm_version"] == "bead-grid-constrained-v3"
    assert payload["meta"]["enhancer"] == "passthrough"
    assert payload["meta"]["background_mode"] == "keep"
    assert payload["meta"]["conversion_style"] == "original"
    assert payload["meta"]["applied_background_mode"] == "keep"
    assert payload["meta"]["background_processing"] == "none"
    assert "background_color" not in payload["meta"]
    assert payload["meta"]["color_set_size"] == color_set_size
    assert payload["meta"]["color_budget_mode"] == "legacy-explicit"
    assert payload["meta"]["color_budget_policy_version"] == "grid-color-budget-v2"
    assert payload["meta"]["effective_max_colors"] == 8
    assert payload["meta"]["color_chart_version"] == "1.0"
    assert payload["meta"]["actual_color_count"] <= 8
    selected_set = get_color_chart().get_set(color_set_size)
    assert selected_set is not None
    allowed_codes = {color.code for color in selected_set.colors}
    assert {color["code"] for color in payload["foreground"]["palette"]} <= allowed_codes
    assert payload["stats"]["color_count"] == len(payload["foreground"]["palette"])
    assert payload["background"] == {"mode": "none"}


def test_ai_keep_conversion_backs_up_original_and_seedream_images(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Keep 模式只保存输入与 Seedream 结果，并使用同一毫秒时间戳。"""
    backup_dir = tmp_path / "assets" / "images"
    app.dependency_overrides[get_image_enhancer] = FakeAiEnhancer
    app.dependency_overrides[provide_settings] = lambda: Settings(
        _env_file=None,
        image_enhancer="passthrough",
        image_backup_dir=backup_dir,
        api_key_hash_pepper="test-hash-pepper",
    )
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(), "image/png")},
            data={
                "grid_size": "8",
                "max_colors": "8",
                "color_set_size": "24",
                "conversion_style": "original",
                "background_mode": "keep",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides.pop(provide_settings, None)

    assert response.status_code == 200
    originals = list(backup_dir.glob("*-original.png"))
    seedream = list(backup_dir.glob("*-seedream-enhanced.png"))
    assert len(originals) == len(seedream) == 1
    assert not list(backup_dir.glob("*-foreground-final.png"))
    assert len(list(backup_dir.glob("*-foreground-metrics.json"))) == 1
    assert originals[0].stem.removesuffix("-original") == seedream[0].stem.removesuffix(
        "-seedream-enhanced"
    )
    with Image.open(originals[0]) as original_image:
        assert original_image.getpixel((0, 0)) == (255, 0, 0, 255)
    with Image.open(seedream[0]) as seedream_image:
        assert seedream_image.getpixel((0, 0)) == (0, 0, 255, 255)
    assert FakeAiEnhancer.last_options is not None
    assert FakeAiEnhancer.last_options.grid_size == 8
    assert FakeAiEnhancer.last_options.color_budget_band is ColorBudgetBand.RESTRAINED
    assert FakeAiEnhancer.last_options.conversion_style is ConversionStyle.ORIGINAL


def test_ai_solid_conversion_backs_up_seedream_and_final_foreground_stages(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Solid 模式保存不透明 Seedream 图和量化前最终 RGBA。"""
    backup_dir = tmp_path / "assets" / "images"
    app.dependency_overrides[get_image_enhancer] = FakeAiEnhancer
    app.dependency_overrides[provide_settings] = lambda: Settings(
        _env_file=None,
        image_enhancer="passthrough",
        image_backup_dir=backup_dir,
        api_key_hash_pepper="test-hash-pepper",
    )
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(size=(16, 16)), "image/png")},
            data={
                "grid_size": "8",
                "color_set_size": "24",
                "conversion_style": "original",
                "background_mode": "solid",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides.pop(provide_settings, None)

    assert response.status_code == 200
    originals = list(backup_dir.glob("*-original.png"))
    seedream = list(backup_dir.glob("*-seedream-enhanced.png"))
    final = list(backup_dir.glob("*-foreground-final.png"))
    metrics = list(backup_dir.glob("*-foreground-metrics.json"))
    assert len(originals) == len(seedream) == len(final) == len(metrics) == 1
    timestamps = {
        originals[0].stem.removesuffix("-original"),
        seedream[0].stem.removesuffix("-seedream-enhanced"),
        final[0].stem.removesuffix("-foreground-final"),
        metrics[0].stem.removesuffix("-foreground-metrics"),
    }
    assert len(timestamps) == 1
    with Image.open(seedream[0]) as seedream_image:
        assert seedream_image.getpixel((0, 0)) == (0, 0, 255, 255)
    with Image.open(final[0]) as onnx_image:
        assert onnx_image.getpixel((0, 0)) == (0, 0, 255, 0)
        assert onnx_image.getpixel((8, 8)) == (0, 0, 255, 255)
    stage_metrics = json.loads(metrics[0].read_text(encoding="utf-8"))
    assert stage_metrics["requested_key"] == "#00FF00"
    assert stage_metrics["background_processing"] == "local_matte"
    assert stage_metrics["foreground_model_version"] == "test-v1"


@pytest.mark.parametrize("conversion_style", list(ConversionStyle))
def test_conversion_style_reaches_enhancer_and_response_meta(
    client: TestClient,
    conversion_style: ConversionStyle,
) -> None:
    FakeAiEnhancer.last_options = None
    app.dependency_overrides[get_image_enhancer] = FakeAiEnhancer
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(), "image/png")},
            data={
                "grid_size": "8",
                "color_set_size": "24",
                "conversion_style": conversion_style.value,
                "background_mode": "keep",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)

    assert response.status_code == 200
    assert FakeAiEnhancer.last_options is not None
    assert FakeAiEnhancer.last_options.conversion_style is conversion_style
    assert response.json()["meta"]["conversion_style"] == conversion_style.value


def test_passthrough_rejects_non_original_style_before_reading_image(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "8",
            "color_set_size": "24",
            "conversion_style": "chibi",
            "background_mode": "keep",
        },
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "CONVERSION_STYLE_UNAVAILABLE"


@pytest.mark.parametrize("conversion_style", [None, "watercolor"])
def test_missing_or_unknown_conversion_style_is_rejected_by_validation(
    client: TestClient,
    conversion_style: str | None,
) -> None:
    data = {
        "grid_size": "8",
        "color_set_size": "24",
        "background_mode": "keep",
    }
    if conversion_style is not None:
        data["conversion_style"] = conversion_style

    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data=data,
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("grid_size", "expected_max_colors"),
    [(8, 8), (52, 30), (78, 48), (104, 48)],
)
def test_create_conversion_uses_auto_color_budget_when_max_is_omitted(
    client: TestClient,
    grid_size: int,
    expected_max_colors: int,
) -> None:
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": str(grid_size),
            "color_set_size": "48",
            "conversion_style": "original",
            "background_mode": "keep",
        },
    )

    assert response.status_code == 200
    meta = response.json()["meta"]
    assert meta["color_budget_mode"] == "auto"
    assert meta["color_budget_policy_version"] == "grid-color-budget-v2"
    assert meta["effective_max_colors"] == expected_max_colors
    assert meta["actual_color_count"] <= expected_max_colors


def test_invalid_color_set_has_stable_error(client: TestClient) -> None:
    """不存在的颜色套装使用前端可稳定识别的错误码。"""
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "52",
            "max_colors": "18",
            "color_set_size": "25",
            "conversion_style": "original",
            "background_mode": "keep",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "COLOR_SET_INVALID"


@pytest.mark.parametrize("max_colors", [7, 55])
def test_explicit_max_colors_outside_legacy_range_has_stable_error(
    client: TestClient,
    max_colors: int,
) -> None:
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "52",
            "max_colors": str(max_colors),
            "color_set_size": "48",
            "conversion_style": "original",
            "background_mode": "keep",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "MAX_COLORS_INVALID"


@pytest.mark.parametrize("grid_size", [7, 157])
def test_grid_size_outside_range_has_stable_error(
    client: TestClient,
    grid_size: int,
) -> None:
    """网格上限由后端强制执行，不能只依赖前端输入控件。"""
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": str(grid_size),
            "max_colors": "18",
            "color_set_size": "264",
            "conversion_style": "original",
            "background_mode": "keep",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "GRID_SIZE_INVALID"


def test_solid_background_is_normalized_and_returned(client: TestClient) -> None:
    app.dependency_overrides[get_image_enhancer] = FakeSolidEnhancer
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(size=(16, 8)), "image/png")},
            data={
                "grid_size": "8",
                "max_colors": "8",
                "color_set_size": "24",
                "conversion_style": "original",
                "background_mode": "solid",
                "background_color": "#aabbcc",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["background_mode"] == "solid"
    assert payload["meta"]["background_color"] == "#AABBCC"
    assert payload["meta"]["background_processing"] == "local_matte"
    assert payload["meta"]["applied_background_mode"] == "solid"
    assert payload["meta"]["foreground_model_version"] == "test-v1"
    assert payload["background"] == {"mode": "solid", "color": "#AABBCC"}
    assert any(cell is None for row in payload["foreground"]["rows"] for cell in row)
    assert payload["stats"]["bead_count"] > 0
    assert [color["code"] for color in payload["foreground"]["palette"]] == ["H2"]


def test_solid_background_defaults_to_pure_white(client: TestClient) -> None:
    app.dependency_overrides[get_image_enhancer] = FakeSolidEnhancer
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(size=(16, 8)), "image/png")},
            data={
                "grid_size": "8",
                "max_colors": "8",
                "color_set_size": "24",
                "conversion_style": "original",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["background_mode"] == "solid"
    assert payload["meta"]["background_color"] == "#FFFFFF"
    assert payload["meta"]["background_processing"] == "local_matte"
    assert payload["meta"]["applied_background_mode"] == "solid"
    assert payload["background"] == {"mode": "solid", "color": "#FFFFFF"}
    assert any(cell is None for row in payload["foreground"]["rows"] for cell in row)
    assert payload["stats"]["bead_count"] > 0
    assert [color["code"] for color in payload["foreground"]["palette"]] == ["H2"]


def test_solid_low_confidence_can_explicitly_fallback_to_simplify(
    client: TestClient,
    tmp_path: Path,
) -> None:
    event_log_dir = tmp_path / "log"
    app.dependency_overrides[get_image_enhancer] = FakeSolidEnhancer
    app.dependency_overrides[provide_settings] = lambda: Settings(
        _env_file=None,
        app_env="test",
        image_enhancer="passthrough",
        enable_onnx_matting=True,
        event_log_dir=event_log_dir,
        api_key_hash_pepper="test-hash-pepper",
    )
    previous_adapter = app.dependency_overrides[get_foreground_mask_adapter]
    app.dependency_overrides[get_foreground_mask_adapter] = ConstantForegroundMaskAdapter
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(size=(16, 8)), "image/png")},
            data={
                "grid_size": "8",
                "color_set_size": "24",
                "conversion_style": "original",
                "background_mode": "solid",
                "fallback_mode": "simplify",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides.pop(provide_settings, None)
        app.dependency_overrides[get_foreground_mask_adapter] = previous_adapter

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["background_mode"] == "solid"
    assert payload["meta"]["applied_background_mode"] == "simplify"
    assert payload["meta"]["background_processing"] == "fallback_simplify"
    assert payload["meta"]["degraded"] is True
    assert payload["meta"]["degrade_reason"] == "foreground_low_confidence"
    assert payload["background"] == {"mode": "none"}
    paths = list(event_log_dir.glob("*-foreground_degraded.json"))
    assert len(paths) == 1
    event = json.loads(paths[0].read_text(encoding="utf-8"))
    assert event["requested_key"] == "#00FF00"
    assert event["actual_key"] == "#00FF00"
    assert event["foreground_validation_failures"] == [
        "foreground_coverage_above_maximum",
        "background_coverage_below_minimum",
    ]
    assert event["fallback_mask"] == "validated-edge-key"


def test_dynamic_chroma_degradation_persists_exact_reason(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """降级事件通过 request_id 关联请求，并持久化完整键色校验的失败证据。"""
    event_log_dir = tmp_path / "log"
    backup_dir = tmp_path / "images"
    app.dependency_overrides[get_image_enhancer] = FakeChromaDegradedEnhancer
    app.dependency_overrides[provide_settings] = lambda: Settings(
        _env_file=None,
        app_env="test",
        image_enhancer="seedream",
        ark_doubao_api_key="test-key",
        enable_onnx_matting=False,
        image_backup_dir=backup_dir,
        event_log_dir=event_log_dir,
        api_key_hash_pepper="test-hash-pepper",
    )
    try:
        response = client.post(
            "/api/v1/conversions",
            headers={"x-request-id": "req_chroma_degrade"},
            files={"image": ("source.png", make_png_bytes(size=(16, 16)), "image/png")},
            data={
                "grid_size": "8",
                "color_set_size": "24",
                "conversion_style": "original",
                "background_mode": "solid",
                "fallback_mode": "simplify",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides.pop(provide_settings, None)

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "req_chroma_degrade"
    paths = list(event_log_dir.glob("*-foreground_degraded.json"))
    assert len(paths) == 1
    event = json.loads(paths[0].read_text(encoding="utf-8"))
    assert event["event"] == "foreground_degraded"
    assert event["request_id"] == "req_chroma_degrade"
    assert event["processing"] == "fallback_simplify"
    assert event["degrade_reason"] == "foreground_low_confidence"
    assert event["validation_failures"] == [
        "border_coverage_below_minimum",
        "edge_count_below_minimum",
    ]
    assert event["border_coverage"] < event["min_border_coverage"]
    assert event["edge_count"] < event["min_edge_count"]
    metric_paths = list(backup_dir.glob("*-foreground-metrics.json"))
    assert len(metric_paths) == 1
    backup_metrics = json.loads(metric_paths[0].read_text(encoding="utf-8"))
    assert backup_metrics["validation_failures"] == event["validation_failures"]


def test_event_log_failure_does_not_fail_conversion(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """诊断落盘故障不得将已完成的降级转换改为 5xx。"""
    app.dependency_overrides[get_image_enhancer] = FakeSolidEnhancer
    previous_adapter = app.dependency_overrides[get_foreground_mask_adapter]
    app.dependency_overrides[get_foreground_mask_adapter] = ConstantForegroundMaskAdapter

    def fail_to_write(*_args, **_kwargs) -> None:
        raise OSError("disk unavailable")

    monkeypatch.setattr(conversions_route, "write_event_log", fail_to_write)
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(size=(16, 8)), "image/png")},
            data={
                "grid_size": "8",
                "color_set_size": "24",
                "conversion_style": "original",
                "background_mode": "solid",
                "fallback_mode": "simplify",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides[get_foreground_mask_adapter] = previous_adapter

    assert response.status_code == 200
    assert response.json()["meta"]["background_processing"] == "fallback_simplify"


def test_removed_transparent_background_mode_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "8",
            "color_set_size": "24",
            "conversion_style": "original",
            "background_mode": "transparent",
        },
    )

    assert response.status_code == 422


def test_invalid_solid_background_color_has_stable_error(client: TestClient) -> None:
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "8",
            "color_set_size": "24",
            "conversion_style": "original",
            "background_mode": "solid",
            "background_color": "white",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BACKGROUND_COLOR_INVALID"
