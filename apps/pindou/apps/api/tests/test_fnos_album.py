from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from urllib.parse import quote, unquote
from uuid import UUID

import httpx
import pytest
from conftest import make_png_bytes
from fastapi.testclient import TestClient

from pindou.api.dependencies import get_image_delivery_store
from pindou.core.config import get_settings
from pindou.services import fnos_album

SECRET = "c2Vzc2lvbi1zZWNyZXQtZml4dHVyZQ=="
NOW = 1793400000
URL = "https://share.fnnas.net/s/0123456789abcdef"
PATH = "/api/v1/image-deliveries"
FILENAME = "0123456789abcdef0123456789abcdef.png"


@pytest.mark.parametrize(("path", "text", "signature"), [
    ("/p/api/v2/photo/upload/path", "", "6459f73291fd4bc1a6704879e570223f"),
    ("/p/api/v1/share_link/detail", "id=5&name=%E6%8B%BC%E8%B1%86%20%2B",
     "b8253f492bbe3e0587dc7f9328f84c05"),
    ("/p/api/v1/share_link/new",
     '{"photoIds":[48820],"name":"拼豆图纸","validTo":1794004800}',
     "393481a5d15a3c020a8e1450256621aa"),
])
def test_authx_matches_javascript_crypto_fixtures(monkeypatch, path, text, signature):
    """固定向量来自 Node crypto + decodeURIComponent，覆盖中文、空格和加号。"""
    monkeypatch.setattr(fnos_album.secrets, "randbelow", lambda bound: 23456)
    monkeypatch.setattr(fnos_album.time, "time", lambda: 1793400000.123)
    assert fnos_album.authx(path, text) == (
        f"nonce=123456&timestamp=1793400000123&sign={signature}"
    )


@pytest.fixture
def nas(monkeypatch):
    monkeypatch.setenv("NAS_ALBUM_ENABLED", "true")
    monkeypatch.setenv("NAS_ALBUM_BASE_URL", "http://nas.internal:5666")
    monkeypatch.setenv("NAS_ALBUM_ID", "25")
    get_settings.cache_clear()
    monkeypatch.setattr(fnos_album.time, "time", lambda: NOW)
    monkeypatch.setattr(fnos_album.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(fnos_album, "uuid4", lambda: UUID(FILENAME.removesuffix(".png")))
    original_client = httpx.Client

    def install(handler):
        def create_client(**kwargs):
            assert kwargs["follow_redirects"] is False
            assert kwargs["trust_env"] is False
            return original_client(transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(fnos_album.httpx, "Client", create_client)

    return install


def post_delivery(client, *, ost="session-one", secret=SECRET, token=None):
    headers = {"X-Admin-API-Key": "test-admin-key", "Cookie": f"ost={ost}; other=ignored"}
    if secret is not None:
        headers["X-Fnos-Secret"] = secret
    if token is not None:
        headers["X-Fnos-Token"] = token
    return client.post(PATH, headers=headers, files={
        "file": ("untrusted-name.png", make_png_bytes(), "image/png"),
    })


def response_data(data):
    return httpx.Response(200, content=json.dumps({"code": 0, "data": data}).encode())


def success_reply(request, *, repeat=False, ready=True):
    path = request.url.path
    if path.endswith("upload/path"):
        return response_data({"upload": {"path": "/vol2/1001/相册 A/.@#local", "hasAccess": True}})
    if path == "/upload":
        return httpx.Response(200, json={"code": 0})
    if path.endswith("upload/notice"):
        return response_data({"successCount": 0 if repeat else 1, "list": [{
            "id": 48820, "repeat": repeat, "errorCode": 0, "error": "",
        }]})
    if path.endswith("share_link/new"):
        return response_data({
            "id": 5, "url": URL, "validTo": NOW + 604800,
            "photoCount": 1 if ready else 0, "albumId": 0,
        })
    if path.endswith("share_link/detail"):
        return response_data({"id": 5, "photoCount": 1 if ready else 0})
    raise AssertionError(f"Unexpected request path: {path}")


def assert_body_signature(request):
    """独立重算实际传输字节的摘要，防止签名和序列化分离。"""
    fields = dict(part.split("=", 1) for part in request.headers["authx"].split("&"))
    assert 100000 <= int(fields["nonce"]) <= 999999
    assert fields["timestamp"] == str(NOW * 1000)
    text = request.content.decode() if request.method == "POST" else request.url.query.decode()
    digest = hashlib.md5(unquote(text).encode()).hexdigest()
    material = "_".join([
        "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh", request.url.path,
        fields["nonce"], fields["timestamp"], digest,
        "EAECCF25-80A6-4666-A7C2-A76904A74AB6",
    ])
    # 固定材料单独由浏览器的 XOR 表验证，避免复制适配层实现。
    assert fields["sign"] == hashlib.md5(material.encode()).hexdigest()


@pytest.mark.parametrize("repeat", [False, True])
def test_full_upload_share_and_readiness_sequence(client: TestClient, nas, repeat):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.url.host == "nas.internal"
        assert request.headers["cookie"] == "ost=session-one"
        # 第一个上游请求之前已经完成本地保存。
        local_files = list(get_image_delivery_store().directory.glob("*.png"))
        assert len(local_files) == 1
        assert local_files[0].read_bytes() == make_png_bytes()
        if request.url.path != "/upload":
            assert_body_signature(request)
        return success_reply(
            request, repeat=repeat, ready=request.url.path.endswith("share_link/detail")
        )

    nas(handler)
    response = post_delivery(client, token="current-token")
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["share_url"] == URL
    assert datetime.fromisoformat(payload["expires_at"]) == datetime.fromtimestamp(
        NOW + 604800, UTC
    )
    assert response.headers["cache-control"] == "no-store"
    assert [request.url.path for request in requests] == [
        "/p/api/v2/photo/upload/path", "/upload", "/p/api/v1/photo/upload/notice",
        "/p/api/v1/share_link/new", "/p/api/v1/share_link/detail",
    ]
    upload = requests[1]
    expected_path = quote(f"/vol2/1001/相册 A/.@#local/{FILENAME}", safe=fnos_album.ENCODE_URI_SAFE)
    assert upload.headers["trim-path"] == expected_path
    assert upload.headers["trim-overwrite"] == "false"
    assert upload.headers["trim-mtim"] == str(NOW)
    assert upload.headers["trim-flags"] == "1"
    assert upload.headers["trim-token"] == "current-token"
    assert upload.headers["trim-sign"] == base64.b64encode(
        hmac.digest(base64.b64decode(SECRET), expected_path.encode(), "sha256")
    ).decode()
    assert 'name="trim-upload-file"' in upload.content.decode("latin1")
    assert f'filename="{FILENAME}"' in upload.content.decode("latin1")
    assert make_png_bytes() in upload.content
    assert json.loads(requests[2].content) == {
        "files": [{
            "file_create_time": datetime.fromtimestamp(NOW, UTC).strftime("%Y:%m:%d %H:%M:%S"),
            "original_name": "pindou-pattern.png", "file_name": FILENAME,
        }], "album_id": 25,
    }
    assert requests[3].content == (
        '{"photoIds":[48820],"name":"拼豆图纸","validTo":1794004800}'.encode()
    )
    assert requests[4].url.query == b"id=5"


def test_requests_do_not_reuse_session_or_optional_token(client, nas):
    seen = []

    def handler(request):
        seen.append((request.headers["cookie"], request.headers.get("trim-token")))
        return success_reply(request)

    nas(handler)
    assert post_delivery(client, ost="first", token="first-token").status_code == 201
    assert post_delivery(client, ost="second").status_code == 201
    assert {cookie for cookie, _ in seen[:4]} == {"ost=first"}
    assert {cookie for cookie, _ in seen[4:]} == {"ost=second"}
    assert seen[1][1] == "first-token"
    assert seen[5][1] == ""


@pytest.mark.parametrize("secret", [None, "", "%%%", "eA", b"\xe9"])
def test_missing_or_invalid_session_preserves_saved_png(client, nas, secret):
    nas(lambda request: pytest.fail("Invalid credentials must not contact NAS"))
    response = post_delivery(client, secret=secret)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "NAS_ALBUM_SESSION_INVALID"
    assert len(list(get_image_delivery_store().directory.glob("*.png"))) == 1


@pytest.mark.parametrize(("path", "reply", "status", "code"), [
    ("upload/path", httpx.Response(302, headers={"location": "http://attacker.invalid/login"}),
     401, "NAS_ALBUM_SESSION_INVALID"),
    ("upload/path", httpx.Response(401), 401, "NAS_ALBUM_SESSION_INVALID"),
    ("upload/path", httpx.Response(200, json={"code": 401}), 401, "NAS_ALBUM_SESSION_INVALID"),
    ("upload/path", httpx.Response(500), 502, "NAS_ALBUM_UPSTREAM_ERROR"),
    ("upload/path", httpx.Response(200, json={"code": 123, "msg": "secret upstream details"}),
     502, "NAS_ALBUM_UPSTREAM_ERROR"),
    ("upload/path", httpx.Response(200, content=b"<html>login</html>"),
     502, "NAS_ALBUM_INVALID_RESPONSE"),
    ("upload/path", httpx.Response(200, json={"code": [], "data": {}}),
     502, "NAS_ALBUM_UPSTREAM_ERROR"),
    ("upload/path", response_data({"upload": {"path": "/private", "hasAccess": False}}),
     403, "NAS_ALBUM_ACCESS_DENIED"),
    ("/upload", httpx.Response(200, json={"code": 1}), 502, "NAS_ALBUM_UPSTREAM_ERROR"),
    ("upload/notice", response_data({"list": [{"id": 1, "errorCode": 9, "error": "private"}]}),
     502, "NAS_ALBUM_IMPORT_FAILED"),
    ("upload/notice", response_data({"list": [{"id": 0, "repeat": True, "errorCode": 0}]}),
     502, "NAS_ALBUM_INVALID_RESPONSE"),
    ("share_link/new", response_data({"id": 1, "url": "http://attacker.invalid"}),
     502, "NAS_ALBUM_INVALID_RESPONSE"),
    ("share_link/new", response_data({
        "id": 1, "url": URL, "validTo": 0, "photoCount": 1,
    }), 502, "NAS_ALBUM_INVALID_RESPONSE"),
    ("share_link/new", httpx.Response(200, json={"code": 0, "data": []}),
     502, "NAS_ALBUM_INVALID_RESPONSE"),
])
def test_upstream_failures_are_bounded_and_sanitized(client, nas, path, reply, status, code):
    requests = []

    def handler(request):
        requests.append(request)
        if request.url.path.endswith(path):
            return reply
        return success_reply(request)

    nas(handler)
    response = post_delivery(client)
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert requests[-1].url.path.endswith(path)
    assert len(requests) <= 4
    assert len(list(get_image_delivery_store().directory.glob("*.png"))) == 1
    assert "private" not in response.text
    assert "secret upstream" not in response.text
    assert SECRET not in response.text


@pytest.mark.parametrize("directory", [
    None, 25, "relative/path", "//evil/path", "/vol/../x", "/vol/./x", "/vol\nx", "/vol\\x",
    "/\ud800",
])
def test_invalid_upload_path_never_transfers_file(client, nas, directory):
    calls = []

    def handler(request):
        calls.append(request)
        return response_data({"upload": {"path": directory, "hasAccess": True}})

    nas(handler)
    response = post_delivery(client)
    assert response.status_code == 502
    assert len(calls) == 1


def test_share_readiness_wait_is_bounded(client, nas):
    requests = []

    def handler(request):
        requests.append(request)
        return success_reply(request, ready=False)

    nas(handler)
    response = post_delivery(client)
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "NAS_ALBUM_SHARE_NOT_READY"
    assert len(requests) == 4 + fnos_album.READINESS_ATTEMPTS


@pytest.mark.parametrize("error", [httpx.ReadTimeout, httpx.ConnectError])
def test_transport_failure_preserves_local_image(client, nas, error):
    def handler(request):
        raise error("sensitive request details", request=request)

    nas(handler)
    response = post_delivery(client)
    assert response.status_code == (504 if error is httpx.ReadTimeout else 502)
    assert "sensitive" not in response.text
    assert len(list(get_image_delivery_store().directory.glob("*.png"))) == 1


def test_disabled_mode_does_not_require_fnos_session(client, nas, monkeypatch):
    monkeypatch.setenv("NAS_ALBUM_ENABLED", "false")
    get_settings.cache_clear()
    nas(lambda request: pytest.fail("Disabled mode must not contact NAS"))
    response = post_delivery(client, secret=None)
    assert response.status_code == 201
    assert response.json()["share_url"] is None


def test_rejects_share_expiry_that_differs_from_requested_seven_days(client, nas):
    def handler(request):
        response = success_reply(request)
        if request.url.path.endswith("share_link/new"):
            data = response.json()["data"]
            data["validTo"] = NOW + 604799
            return response_data(data)
        return response

    nas(handler)
    response = post_delivery(client)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "NAS_ALBUM_INVALID_RESPONSE"


def test_response_size_is_bounded(client, nas):
    nas(lambda request: httpx.Response(200, content=b" " * (fnos_album.MAX_RESPONSE_BYTES + 1)))
    response = post_delivery(client)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "NAS_ALBUM_INVALID_RESPONSE"


def test_sequence_has_overall_deadline(client, nas, monkeypatch):
    ticks = iter([0, fnos_album.MAX_DURATION_SECONDS + 1])
    monkeypatch.setattr(fnos_album, "time", SimpleNamespace(
        time=lambda: NOW, monotonic=lambda: next(ticks), sleep=lambda seconds: None,
    ))
    nas(lambda request: pytest.fail("Expired deadline must prevent upstream request"))
    response = post_delivery(client)
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "NAS_ALBUM_TIMEOUT"


@pytest.mark.parametrize("url", [
    "https://nas/path", "http://user:password@nas", "http://nas?redirect=evil",
    "file:///tmp", "http://nas:invalid", "http://nas:99999", "http://nas:0",
])
def test_nas_configuration_rejects_non_origin_urls(monkeypatch, url):
    monkeypatch.setenv("NAS_ALBUM_BASE_URL", url)
    get_settings.cache_clear()
    with pytest.raises(ValueError):
        get_settings()
