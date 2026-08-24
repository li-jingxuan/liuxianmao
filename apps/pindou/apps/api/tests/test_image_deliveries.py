from __future__ import annotations

import os

import pytest
from conftest import make_png_bytes
from fastapi.testclient import TestClient

from pindou.api.dependencies import get_image_delivery_store


def test_admin_can_create_preview_and_download_delivery(client: TestClient) -> None:
    """上传、元数据、内联原图和附件下载共享同一份 PNG。"""
    png = make_png_bytes(size=(32, 24))
    created = client.post(
        "/api/v1/image-deliveries",
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", png, "image/png")},
    )

    assert created.status_code == 201
    assert created.headers["cache-control"] == "no-store"
    payload = created.json()
    token = payload["token"]
    assert payload["image_url"] == f"/api/v1/image-deliveries/{token}/image"
    assert payload["download_url"] == f"/api/v1/image-deliveries/{token}/download"

    metadata = client.get(f"/api/v1/image-deliveries/{token}")
    assert metadata.status_code == 200
    assert metadata.headers["cache-control"] == "no-store"
    assert metadata.json() == payload

    viewed = client.get(payload["image_url"])
    assert viewed.status_code == 200
    assert viewed.content == png
    assert viewed.headers["content-type"] == "image/png"
    assert viewed.headers["content-disposition"].startswith("inline;")
    assert viewed.headers["x-content-type-options"] == "nosniff"

    downloaded = client.get(payload["download_url"])
    assert downloaded.status_code == 200
    assert downloaded.content == png
    assert downloaded.headers["content-disposition"].startswith("attachment;")


@pytest.mark.parametrize("admin_key", [None, "", "wrong-admin-key"])
def test_delivery_upload_requires_fixed_admin_key(
    client: TestClient,
    admin_key: str | None,
) -> None:
    """首页按钮可以被伪造显示，但 API 始终独立校验固定管理密钥。"""
    headers = {"X-Admin-API-Key": admin_key} if admin_key is not None else {}
    response = client.post(
        "/api/v1/image-deliveries",
        headers=headers,
        files={"file": ("pattern.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ADMIN_API_KEY_INVALID"


def test_delivery_upload_rejects_non_png(client: TestClient) -> None:
    response = client.post(
        "/api/v1/image-deliveries",
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", b"not-a-png", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "DELIVERY_IMAGE_INVALID"


def test_expired_delivery_is_deleted_and_returns_uniform_404(client: TestClient) -> None:
    created = client.post(
        "/api/v1/image-deliveries",
        headers={"X-Admin-API-Key": "test-admin-key"},
        files={"file": ("pattern.png", make_png_bytes(), "image/png")},
    ).json()
    store = get_image_delivery_store()
    path = store.directory / f"{created['token']}.png"
    expired_timestamp = path.stat().st_mtime - store.ttl_seconds - 1
    os.utime(path, (expired_timestamp, expired_timestamp))

    response = client.get(f"/api/v1/image-deliveries/{created['token']}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DELIVERY_IMAGE_NOT_FOUND"
    assert not path.exists()


def test_cleanup_ignores_unrelated_files(client: TestClient) -> None:
    """清理任务只能删除符合随机 token 命名规则的过期 PNG。"""
    store = get_image_delivery_store()
    unrelated = store.directory / "keep-me.txt"
    unrelated.write_text("safe", encoding="utf-8")

    assert store.delete_expired() == 0
    assert unrelated.read_text(encoding="utf-8") == "safe"


def test_invalid_token_and_missing_file_share_error(client: TestClient) -> None:
    for token in ("bad.token", "A" * 43):
        response = client.get(f"/api/v1/image-deliveries/{token}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "DELIVERY_IMAGE_NOT_FOUND"
