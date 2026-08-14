from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from conftest import make_png_bytes
from fastapi.testclient import TestClient
from PIL import Image

from pindou.api.dependencies import get_color_chart, get_image_enhancer, provide_settings
from pindou.core.config import Settings
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.main import app
from pindou.services.enhancer import EnhancementOptions


class FakeAiEnhancer:
    name = "seedream-5-lite"
    model = "fake-model"
    prompt_version = "fake-prompt"
    last_options: EnhancementOptions | None = None

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> Image.Image:
        type(self).last_options = options
        return Image.new("RGBA", image.size, (0, 0, 255, 255))


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
        headers={"Origin": "http://192.168.1.20:3000"},
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
    assert len(payload["rows"]) == grid_size
    assert all(len(row) == grid_size for row in payload["rows"])
    assert payload["meta"]["enhancer"] == "passthrough"
    assert payload["meta"]["background_mode"] == "keep"
    assert payload["meta"]["background_color"] is None
    assert payload["meta"]["color_set_size"] == color_set_size
    assert payload["meta"]["color_budget_mode"] == "legacy-explicit"
    assert payload["meta"]["color_budget_policy_version"] == "grid-color-budget-v1"
    assert payload["meta"]["effective_max_colors"] == 8
    assert payload["meta"]["color_chart_version"] == "1.0"
    assert payload["meta"]["actual_color_count"] <= 8
    selected_set = get_color_chart().get_set(color_set_size)
    assert selected_set is not None
    allowed_codes = {color.code for color in selected_set.colors}
    assert {color["code"] for color in payload["palette"]} <= allowed_codes


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
    assert originals[0].stem.removesuffix("-original") == enhanced[0].stem.removesuffix(
        "-enhanced"
    )
    with Image.open(originals[0]) as original_image:
        assert original_image.getpixel((0, 0)) == (255, 0, 0, 255)
    with Image.open(enhanced[0]) as enhanced_image:
        assert enhanced_image.getpixel((0, 0)) == (0, 0, 255, 255)
    assert FakeAiEnhancer.last_options is not None
    assert FakeAiEnhancer.last_options.grid_size == 8
    assert FakeAiEnhancer.last_options.color_budget_band is ColorBudgetBand.RESTRAINED


@pytest.mark.parametrize(
    ("grid_size", "expected_max_colors"),
    [(8, 8), (52, 12), (78, 18), (104, 24)],
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
    assert meta["color_budget_policy_version"] == "grid-color-budget-v1"
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


@pytest.mark.parametrize("max_colors", [7, 25])
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
    """纯色会统一为大写 HEX，并同时作为画布补边元数据。"""
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

    assert response.status_code == 200
    assert response.json()["meta"]["background_color"] == "#AABBCC"


def test_transparent_background_returns_unoccupied_cells_without_background_color(
    client: TestClient,
) -> None:
    """透明背景使用真实 Alpha 空格，不返回纯色背景字段。"""
    image = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    for y in range(8):
        for x in range(4):
            image.putpixel((x, y), (0, 0, 0, 0))
    output = BytesIO()
    image.save(output, format="PNG")
    image.close()

    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", output.getvalue(), "image/png")},
        data={
            "grid_size": "8",
            "max_colors": "8",
            "color_set_size": "24",
            "background_mode": "transparent",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "2"
    assert payload["meta"]["background_mode"] == "transparent"
    assert "background_color" not in payload["meta"]
    assert sum(cell != -1 for row in payload["rows"] for cell in row) == 32
