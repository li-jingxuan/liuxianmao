from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from pindou.api.dependencies import get_color_chart, get_image_enhancer
from pindou.core.config import get_settings
from pindou.main import app


@pytest.fixture(autouse=True)
def isolate_tests_from_real_seedream(monkeypatch: pytest.MonkeyPatch):
    """测试始终强制 passthrough，禁止读取真实 Key 或产生方舟费用。"""
    monkeypatch.setenv("IMAGE_ENHANCER", "passthrough")
    get_settings.cache_clear()
    get_color_chart.cache_clear()
    get_image_enhancer.cache_clear()
    yield
    get_settings.cache_clear()
    get_color_chart.cache_clear()
    get_image_enhancer.cache_clear()


@pytest.fixture
def client() -> TestClient:
    """使用 TestClient 触发完整 FastAPI lifespan，确保色卡会在测试启动时校验。"""
    with TestClient(app) as test_client:
        yield test_client


def make_png_bytes(
    color: tuple[int, int, int, int] = (255, 0, 0, 255),
    size: tuple[int, int] = (16, 16),
) -> bytes:
    """在内存中生成可控的 PNG，避免测试依赖外部图片文件。"""
    image = Image.new("RGBA", size, color)
    output = BytesIO()
    image.save(output, format="PNG")
    image.close()
    return output.getvalue()
