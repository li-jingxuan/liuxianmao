from __future__ import annotations

import pytest
from conftest import make_png_bytes

from pindou.api.dependencies import get_image_delivery_store
from pindou.api.routes import image_deliveries
from pindou.core.config import get_settings

PATH = "/api/v1/image-deliveries"


@pytest.fixture
def browser_album(monkeypatch):
    """浏览器模式连相册客户端也不应构造，避免后端接触系统会话。"""
    monkeypatch.setenv("NAS_ALBUM_ENABLED", "true")
    monkeypatch.setenv("NAS_ALBUM_ID", "37")
    get_settings.cache_clear()

    def reject_client(*args, **kwargs):
        pytest.fail("浏览器模式不应构造后端相册客户端")

    monkeypatch.setattr(image_deliveries, "FnosAlbumClient", reject_client)


def test_browser_mode_saves_without_session_and_returns_configured_album(client, browser_album):
    """模拟网关过滤 ost，且前端不再把会话密钥或 token 发给后端。"""
    png = make_png_bytes(size=(32, 24))
    response = client.post(
        PATH,
        params={"share_mode": "browser"},
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", png, "image/png")},
    )

    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert payload["nas_album_id"] == 37
    assert payload["share_url"] is None
    store = get_image_delivery_store()
    saved = store.get(payload["token"])
    assert saved is not None
    assert saved.path.read_bytes() == png
    assert client.get(payload["image_url"]).content == png
    assert client.get(payload["download_url"]).content == png
    metadata = client.get(f"{PATH}/{payload['token']}")
    assert metadata.status_code == 200
    assert metadata.json() == {**payload, "nas_album_id": None}


@pytest.mark.parametrize("share_mode", ["browser", "server"])
def test_disabled_album_returns_no_album_id(client, browser_album, monkeypatch, share_mode):
    monkeypatch.setenv("NAS_ALBUM_ENABLED", "false")
    get_settings.cache_clear()
    response = client.post(
        PATH,
        params={"share_mode": share_mode},
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 201, response.text
    assert response.json()["nas_album_id"] is None
    assert response.json()["share_url"] is None
    assert len(list(get_image_delivery_store().directory.glob("*.png"))) == 1


@pytest.mark.parametrize("admin_key", [None, "", "wrong-admin-key"])
def test_browser_mode_requires_admin_key(client, browser_album, admin_key):
    headers = {"X-Admin-API-Key": admin_key} if admin_key is not None else {}
    response = client.post(
        PATH,
        params={"share_mode": "browser"},
        headers=headers,
        files={"file": ("pattern.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ADMIN_API_KEY_INVALID"
    assert not list(get_image_delivery_store().directory.glob("*.png"))


@pytest.mark.parametrize("share_mode", ["", "Browser", "invalid"])
def test_invalid_share_mode_is_rejected_before_saving(client, browser_album, share_mode):
    response = client.post(
        PATH,
        params={"share_mode": share_mode},
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 422
    assert not list(get_image_delivery_store().directory.glob("*.png"))


def test_browser_mode_still_rejects_invalid_png(client, browser_album):
    response = client.post(
        PATH,
        params={"share_mode": "browser"},
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", b"not-a-png", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "DELIVERY_IMAGE_INVALID"
    assert not list(get_image_delivery_store().directory.glob("*.png"))
