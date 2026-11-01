"""fnOS 相册适配：会话只用于本次请求，所有请求均发往服务端配置的同一来源。"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote, unquote, urlencode
from uuid import uuid4

import httpx

from pindou.core.errors import ApiError

SHARE_TTL_SECONDS = 604800
MAX_RESPONSE_BYTES = 1024 * 1024
READINESS_ATTEMPTS = 4
MAX_DURATION_SECONDS = 90
ENCODE_URI_SAFE = ";/?:@&=+$,-_.!~*'()#"
_SIGN_PREFIX = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh"
_SIGN_MATERIAL = bytes(
    value ^ 119
    for value in [
        50, 54, 50, 52, 52, 49, 69, 66, 90, 79, 71, 54, 65, 90, 67, 65, 65, 65,
        90, 54, 64, 52, 69, 90, 54, 64, 65, 78, 71, 67, 54, 64, 67, 54, 53, 65,
    ]
).decode("ascii")


@dataclass(frozen=True)
class AlbumShare:
    url: str
    expires_at: datetime


class _DeadlineReader:
    """每个 multipart 块发送前检查截止时间，避免慢上传无限延长流程。"""

    def __init__(self, source: BinaryIO, deadline: float) -> None:
        self.source = source
        self.deadline = deadline

    def fileno(self) -> int:
        return self.source.fileno()

    def seek(self, offset: int) -> int:
        return self.source.seek(offset)

    def read(self, size: int = -1) -> bytes:
        if time.monotonic() >= self.deadline:
            raise httpx.WriteTimeout("NAS upload deadline exceeded")
        return self.source.read(size)


def authx(path: str, input_text: str) -> str:
    """复现网页签名；POST 的 input_text 也是实际发送的原始 JSON。"""
    nonce = str(secrets.randbelow(900000) + 100000)
    timestamp = str(int(time.time() * 1000))
    digest = hashlib.md5(unquote(input_text, errors="strict").encode()).hexdigest()
    material = "_".join([_SIGN_PREFIX, path, nonce, timestamp, digest, _SIGN_MATERIAL])
    signature = hashlib.md5(material.encode()).hexdigest()
    return f"nonce={nonce}&timestamp={timestamp}&sign={signature}"


def _invalid_response() -> ApiError:
    return ApiError(502, "NAS_ALBUM_INVALID_RESPONSE", "相册服务返回了无效数据，图纸已保存在本地")


def _session_expired() -> ApiError:
    return ApiError(
        401, "NAS_ALBUM_SESSION_INVALID", "飞牛登录已失效，请重新登录后重试，图纸已保存在本地"
    )


def _positive_int(value: object) -> bool:
    return type(value) is int and value > 0


class FnosAlbumClient:
    """每次交付创建一个实例和 HTTP client，不缓存或持久化 Cookie/secret。"""

    def __init__(self, *, base_url: str, album_id: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.album_id = album_id

    def upload_and_share(
        self, image: Path, *, ost: str | None, secret: str | None, token: str | None
    ) -> AlbumShare:
        if not ost or not secret or len(secret) > 4096:
            raise _session_expired()
        try:
            secret_key = base64.b64decode(secret, validate=True)
        except (ValueError, binascii.Error):
            raise _session_expired() from None
        if not secret_key or len(ost) > 8192 or len(token or "") > 8192 or any(
            ord(char) < 32 or ord(char) > 126 for char in (ost + (token or ""))
        ) or any(char in ost for char in ';,"'):
            raise _session_expired()
        self._deadline = time.monotonic() + MAX_DURATION_SECONDS
        try:
            # 不使用进程代理、共享 Cookie jar 或重定向；ost 永不离开配置的 NAS。
            with httpx.Client(
                base_url=self.base_url,
                cookies={"ost": ost},
                follow_redirects=False,
                trust_env=False,
                timeout=httpx.Timeout(10.0, connect=3.0, write=30.0),
            ) as client:
                upload_data = self._api(client, "GET", "/p/api/v2/photo/upload/path")
                upload = upload_data.get("upload")
                if not isinstance(upload, dict):
                    raise _invalid_response()
                if upload.get("hasAccess") is not True:
                    raise ApiError(
                        403, "NAS_ALBUM_ACCESS_DENIED", "没有相册上传权限，图纸已保存在本地"
                    )
                directory = upload.get("path")
                if (
                    not isinstance(directory, str)
                    or len(directory) > 4096
                    or not directory.startswith("/")
                    or directory.startswith("//")
                    or "\\" in directory
                    or any(ord(char) < 32 or ord(char) == 127 for char in directory)
                    or any(part in {".", ".."} for part in directory.split("/"))
                ):
                    raise _invalid_response()
                filename = f"{uuid4().hex}.png"
                try:
                    encoded_path = quote(
                        f"{directory.rstrip('/')}/{filename}", safe=ENCODE_URI_SAFE
                    )
                except UnicodeError:
                    raise _invalid_response() from None
                now = int(time.time())
                signature = base64.b64encode(
                    hmac.digest(secret_key, encoded_path.encode(), "sha256")
                ).decode("ascii")
                with image.open("rb") as png:
                    self._request(
                        client, "POST", "/upload", allow_empty=True,
                        headers={
                            "Trim-Path": encoded_path,
                            "Trim-Overwrite": "false",
                            "Trim-Mtim": str(now),
                            "Trim-Flags": "1",
                            "Trim-Token": token or "",
                            "Trim-Sign": signature,
                        },
                        files={
                            "trim-upload-file": (
                                filename, _DeadlineReader(png, self._deadline), "image/png"
                            )
                        },
                    )
                notice = self._api(client, "POST", "/p/api/v1/photo/upload/notice", body={
                    "files": [{
                        "file_create_time": datetime.fromtimestamp(now, UTC).strftime(
                            "%Y:%m:%d %H:%M:%S"
                        ),
                        "original_name": "pindou-pattern.png",
                        "file_name": filename,
                    }],
                    "album_id": self.album_id,
                })
                photos = notice.get("list")
                if not isinstance(photos, list) or len(photos) != 1:
                    raise _invalid_response()
                photo = photos[0]
                if not isinstance(photo, dict):
                    raise _invalid_response()
                if type(photo.get("errorCode")) is not int:
                    raise _invalid_response()
                if photo["errorCode"] != 0 or photo.get("error"):
                    raise ApiError(502, "NAS_ALBUM_IMPORT_FAILED", "相册入库失败，图纸已保存在本地")
                # repeat:true 携带已有有效 ID 是成功，不能依赖 successCount。
                photo_id = photo.get("id")
                if not _positive_int(photo_id):
                    raise _invalid_response()
                valid_to = int(time.time()) + SHARE_TTL_SECONDS
                share = self._api(client, "POST", "/p/api/v1/share_link/new", body={
                    "photoIds": [photo_id], "name": "拼豆图纸", "validTo": valid_to,
                })
                share_id = share.get("id")
                url = share.get("url")
                expires = share.get("validTo")
                if (
                    not _positive_int(share_id)
                    or not isinstance(url, str)
                    or not re.fullmatch(r"https://share\.fnnas\.net/s/[A-Za-z0-9_-]+", url)
                    or not _positive_int(expires)
                    or expires != valid_to
                ):
                    raise _invalid_response()
                self._wait_until_ready(client, share, share_id)
                return AlbumShare(url=url, expires_at=datetime.fromtimestamp(expires, UTC))
        except httpx.TimeoutException:
            raise ApiError(
                504, "NAS_ALBUM_TIMEOUT", "相册服务响应超时，图纸已保存在本地，请稍后重试"
            ) from None
        except httpx.HTTPError:
            raise ApiError(
                502, "NAS_ALBUM_UNAVAILABLE", "相册服务暂时不可用，图纸已保存在本地"
            ) from None
        except OSError:
            raise ApiError(507, "DELIVERY_STORAGE_UNAVAILABLE", "无法读取已保存的图纸") from None

    def _wait_until_ready(self, client: httpx.Client, share: dict, share_id: int) -> None:
        for attempt in range(READINESS_ATTEMPTS + 1):
            count = share.get("photoCount")
            if type(count) is not int or count < 0 or count > 1:
                raise _invalid_response()
            if count == 1:
                return
            if attempt == READINESS_ATTEMPTS:
                break
            if attempt:
                time.sleep(0.5)
            share = self._api(
                client, "GET", "/p/api/v1/share_link/detail", params={"id": share_id}
            )
        raise ApiError(
            504, "NAS_ALBUM_SHARE_NOT_READY", "相册分享尚未就绪，图纸已保存在本地，请稍后重试"
        )

    def _api(
        self, client: httpx.Client, method: str, path: str,
        *, body: dict | None = None, params: dict | None = None,
    ) -> dict:
        text = (
            json.dumps(body, ensure_ascii=False, separators=(",", ":"))
            if body is not None else urlencode(sorted((params or {}).items()), quote_via=quote)
        )
        try:
            signature = authx(path, text)
        except (UnicodeError, ValueError):
            raise _invalid_response() from None
        headers = {"authx": signature}
        kwargs = {}
        if body is not None:
            headers["Content-Type"] = "application/json"
            kwargs["content"] = text.encode("utf-8")
        result = self._request(
            client, method, f"{path}?{text}" if params else path, headers=headers, **kwargs
        )
        if type(result.get("code")) is not int or not isinstance(result.get("data"), dict):
            raise _invalid_response()
        return result["data"]

    def _request(
        self, client: httpx.Client, method: str, path: str,
        *, allow_empty: bool = False, **kwargs,
    ) -> dict:
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise httpx.ReadTimeout("NAS request deadline exceeded")
        timeout = httpx.Timeout(
            min(10.0, remaining), connect=min(3.0, remaining), write=min(30.0, remaining)
        )
        with client.stream(method, path, timeout=timeout, **kwargs) as response:
            if response.status_code in {401, 403} or response.is_redirect:
                raise _session_expired()
            if not response.is_success:
                raise ApiError(
                    502, "NAS_ALBUM_UPSTREAM_ERROR", "相册服务请求失败，图纸已保存在本地"
                )
            chunks = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() >= self._deadline:
                    raise httpx.ReadTimeout("NAS request deadline exceeded")
                chunks.extend(chunk)
                if len(chunks) > MAX_RESPONSE_BYTES:
                    raise _invalid_response()
            if not chunks and allow_empty:
                return {}
            try:
                payload = json.loads(chunks)
            except (ValueError, UnicodeError, RecursionError):
                raise _invalid_response() from None
            if not isinstance(payload, dict):
                raise _invalid_response()
            for key in ("code", "errno", "errorCode"):
                if key in payload and (type(payload[key]) is not int or payload[key] != 0):
                    if type(payload[key]) is int and payload[key] in {401, 403}:
                        raise _session_expired()
                    raise ApiError(
                        502, "NAS_ALBUM_UPSTREAM_ERROR", "相册服务请求失败，图纸已保存在本地"
                    )
            if payload.get("success") is False:
                raise ApiError(
                    502, "NAS_ALBUM_UPSTREAM_ERROR", "相册服务请求失败，图纸已保存在本地"
                )
            return payload
