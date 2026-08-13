from __future__ import annotations

import pytest
from conftest import make_png_bytes
from fastapi.testclient import TestClient

from pindou.api.dependencies import get_color_chart


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
    assert response.headers["access-control-expose-headers"] == "x-request-id"


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
        240,
        264,
    ]
    assert all(item["size"] == item["color_count"] for item in payload["sets"])


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
    assert payload["meta"]["color_chart_version"] == "1.0"
    assert payload["meta"]["actual_color_count"] <= 8
    selected_set = get_color_chart().get_set(color_set_size)
    assert selected_set is not None
    allowed_codes = {color.code for color in selected_set.colors}
    assert {color["code"] for color in payload["palette"]} <= allowed_codes


def test_invalid_color_set_has_stable_error(client: TestClient) -> None:
    """不存在的累计套装使用前端可稳定识别的错误码。"""
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


def test_grid_size_outside_range_has_stable_error(client: TestClient) -> None:
    """网格上限由后端强制执行，不能只依赖前端输入控件。"""
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "157",
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


def test_legacy_transparent_background_is_rejected(client: TestClient) -> None:
    """旧 transparent 与“简化背景”语义不同，不做静默兼容。"""
    response = client.post(
        "/api/v1/conversions",
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": "8",
            "max_colors": "8",
            "color_set_size": "24",
            "background_mode": "transparent",
        },
    )

    assert response.status_code == 422
