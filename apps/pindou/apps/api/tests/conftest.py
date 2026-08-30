from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, SQLModel

from pindou.api.dependencies import (
    get_color_chart,
    get_image_delivery_store,
    get_image_enhancer,
)
from pindou.core.config import get_settings
from pindou.db.session import dispose_engine, get_engine
from pindou.imaging.foreground import RawForegroundMask
from pindou.main import app
from pindou.models import ApiAccessKey, ApiKeyPrefix  # noqa: F401
from pindou.services.access_keys import AccessKeyService, KeyPrefixService


class TestForegroundMaskAdapter:
    """用稳定中心软蒙版让接口测试不依赖本机 ONNX Runtime。"""

    name = "test-foreground"
    model_version = "test-v1"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        mask = Image.new("L", image.size, 0)
        left = max(1, image.width // 4)
        top = max(1, image.height // 4)
        right = max(left + 1, image.width - left)
        bottom = max(top + 1, image.height - top)
        for x in range(left, right):
            for y in range(top, bottom):
                mask.putpixel((x, y), 255)
        return RawForegroundMask(mask, self.name, self.model_version)


@pytest.fixture(autouse=True)
def isolate_tests_from_external_services(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> str:
    """测试使用隔离 SQLite 和 passthrough，不接触生产数据库或付费 API。"""
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("IMAGE_ENHANCER", "passthrough")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'pindou-test.db'}")
    monkeypatch.setenv("KEY_ISSUER_API_KEY", "test-admin-key")
    monkeypatch.setenv("API_KEY_HASH_PEPPER", "test-hash-pepper")
    # 每个测试使用独立交付目录，避免公开链接文件污染源码或其他用例。
    monkeypatch.setenv("IMAGE_DELIVERY_DIR", str(tmp_path / "image-deliveries"))
    # 事件日志同样按用例隔离，禁止测试数据写入仓库的 log/。
    monkeypatch.setenv("EVENT_LOG_DIR", str(tmp_path / "event-log"))
    monkeypatch.setenv("IMAGE_DELIVERY_TTL_SECONDS", "3600")
    get_settings.cache_clear()
    dispose_engine()
    get_color_chart.cache_clear()
    get_image_enhancer.cache_clear()
    get_image_delivery_store.cache_clear()

    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        KeyPrefixService(session).add(code="web", display_name="Web")
        issued = AccessKeyService(session, hash_pepper="test-hash-pepper").issue(
            prefix_code="web",
            allowed_uses=1_000_000,
        )

    yield issued.key

    dispose_engine()
    get_settings.cache_clear()
    get_color_chart.cache_clear()
    get_image_enhancer.cache_clear()
    get_image_delivery_store.cache_clear()


@pytest.fixture
def client(isolate_tests_from_external_services: str) -> TestClient:
    """使用 TestClient 触发完整 FastAPI lifespan，确保色卡会在测试启动时校验。"""
    with TestClient(
        app,
        headers={"X-API-Key": isolate_tests_from_external_services},
    ) as test_client:
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
