from __future__ import annotations

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
from pindou.core.config import Settings
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import RawForegroundMask
from pindou.main import app
from pindou.schemas.conversion import BackgroundMode
from pindou.services.enhancer import EnhancementOptions, EnhancementResult


class FakeAiEnhancer:
    name = "seedream-5-lite"
    model = "fake-model"
    prompt_version = "fake-prompt"
    last_options: EnhancementOptions | None = None

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        type(self).last_options = options
        return EnhancementResult(
            image=Image.new("RGBA", image.size, (0, 0, 255, 255)),
        )


class FakeSolidEnhancer:
    """模拟返回普通不透明图的增强器，Solid 正确性由本地蒙版负责。"""

    name = "passthrough"
    model = None
    prompt_version = None

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        assert options.background_mode is BackgroundMode.SOLID
        return EnhancementResult(image=Image.new("RGBA", image.size, (255, 255, 255, 255)))


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
            "background_mode": "keep",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["width"] == payload["height"] == grid_size
    assert len(payload["foreground"]["rows"]) == grid_size
    assert all(len(row) == grid_size for row in payload["foreground"]["rows"])
    assert payload["schema_version"] == "3"
    assert payload["algorithm_version"] == "bead-grid-constrained-v3"
    assert payload["meta"]["enhancer"] == "passthrough"
    assert payload["meta"]["background_mode"] == "keep"
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


def test_ai_conversion_backs_up_original_and_enhanced_images(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """AI 请求会在量化前把输入与增强结果按同一毫秒时间戳配对保存。"""
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
                "background_mode": "keep",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides.pop(provide_settings, None)

    assert response.status_code == 200
    originals = list(backup_dir.glob("*-original.png"))
    enhanced = list(backup_dir.glob("*-enhanced.png"))
    assert len(originals) == len(enhanced) == 1
    assert originals[0].stem.removesuffix("-original") == enhanced[0].stem.removesuffix("-enhanced")
    with Image.open(originals[0]) as original_image:
        assert original_image.getpixel((0, 0)) == (255, 0, 0, 255)
    with Image.open(enhanced[0]) as enhanced_image:
        assert enhanced_image.getpixel((0, 0)) == (0, 0, 255, 255)
    assert FakeAiEnhancer.last_options is not None
    assert FakeAiEnhancer.last_options.grid_size == 8
    assert FakeAiEnhancer.last_options.color_budget_band is ColorBudgetBand.RESTRAINED


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
) -> None:
    app.dependency_overrides[get_image_enhancer] = FakeSolidEnhancer
    previous_adapter = app.dependency_overrides[get_foreground_mask_adapter]
    app.dependency_overrides[get_foreground_mask_adapter] = ConstantForegroundMaskAdapter
    try:
        response = client.post(
            "/api/v1/conversions",
            files={"image": ("source.png", make_png_bytes(size=(16, 8)), "image/png")},
            data={
                "grid_size": "8",
                "color_set_size": "24",
                "background_mode": "solid",
                "fallback_mode": "simplify",
            },
        )
    finally:
        app.dependency_overrides.pop(get_image_enhancer, None)
        app.dependency_overrides[get_foreground_mask_adapter] = previous_adapter

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["background_mode"] == "solid"
    assert payload["meta"]["applied_background_mode"] == "simplify"
    assert payload["meta"]["background_processing"] == "fallback_simplify"
    assert payload["meta"]["degraded"] is True
    assert payload["meta"]["degrade_reason"] == "foreground_low_confidence"
    assert payload["background"] == {"mode": "none"}


def test_removed_transparent_background_mode_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "8",
            "color_set_size": "24",
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
            "background_mode": "solid",
            "background_color": "white",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BACKGROUND_COLOR_INVALID"
