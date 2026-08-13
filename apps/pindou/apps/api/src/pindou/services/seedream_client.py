"""火山方舟 Seedream 图片生成 HTTP 客户端。"""

from __future__ import annotations

import base64
import binascii
import json
from dataclasses import dataclass

import httpx


@dataclass(frozen=True, slots=True)
class SeedreamResult:
    """上游成功生成的单张图片及可观测元数据。"""

    image_bytes: bytes
    model: str
    size: str | None
    generated_images: int
    upstream_request_id: str | None


class SeedreamUpstreamError(Exception):
    """不包含请求图片和密钥的上游错误。"""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.request_id = request_id


class SeedreamClient:
    """仅封装项目所需的单参考图、单图输出契约。"""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        image_size: str,
        watermark: bool,
        max_response_bytes: int,
        timeout: httpx.Timeout,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._model = model
        self._image_size = image_size
        self._watermark = watermark
        self._max_response_bytes = max_response_bytes
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        """关闭连接池，由 FastAPI lifespan 在进程退出时调用。"""
        self._client.close()

    def edit_image(self, *, image_data_url: str, prompt: str) -> SeedreamResult:
        """发起非流式单图编辑，严格验证上游 JSON 和 Base64。"""
        payload = {
            "model": self._model,
            "prompt": prompt,
            "image": image_data_url,
            "size": self._image_size,
            "sequential_image_generation": "disabled",
            "stream": False,
            "response_format": "b64_json",
            "watermark": self._watermark,
        }

        try:
            with self._client.stream("POST", "/images/generations", json=payload) as response:
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > self._max_response_bytes:
                        raise SeedreamUpstreamError(
                            502, "RESPONSE_TOO_LARGE", "Seedream 响应超过大小限制"
                        )
                request_id = response.headers.get("x-request-id") or response.headers.get(
                    "x-tt-logid"
                )
                parsed = self._parse_json(bytes(body), response.status_code, request_id)
        except SeedreamUpstreamError:
            raise
        except httpx.TimeoutException as exc:
            raise SeedreamUpstreamError(504, "TIMEOUT", "Seedream 请求超时") from exc
        except httpx.HTTPError as exc:
            raise SeedreamUpstreamError(502, "NETWORK_ERROR", "Seedream 网络请求失败") from exc

        data = parsed.get("data")
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise SeedreamUpstreamError(502, "INVALID_RESPONSE", "Seedream 未返回唯一图片")
        encoded = data[0].get("b64_json")
        if not isinstance(encoded, str) or not encoded:
            raise SeedreamUpstreamError(502, "INVALID_RESPONSE", "Seedream 响应缺少 b64_json")
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise SeedreamUpstreamError(502, "INVALID_IMAGE", "Seedream 返回了无效图片") from exc

        usage = parsed.get("usage") if isinstance(parsed.get("usage"), dict) else {}
        generated_images = usage.get("generated_images", 1)
        return SeedreamResult(
            image_bytes=image_bytes,
            model=str(parsed.get("model") or self._model),
            size=data[0].get("size") if isinstance(data[0].get("size"), str) else None,
            generated_images=generated_images if isinstance(generated_images, int) else 1,
            upstream_request_id=request_id,
        )

    @staticmethod
    def _parse_json(body: bytes, status_code: int, request_id: str | None) -> dict[str, object]:
        try:
            parsed = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise SeedreamUpstreamError(
                502, "INVALID_RESPONSE", "Seedream 返回了无效 JSON", request_id
            ) from exc
        if not isinstance(parsed, dict):
            raise SeedreamUpstreamError(
                502, "INVALID_RESPONSE", "Seedream 返回结构异常", request_id
            )
        if status_code >= 400 or isinstance(parsed.get("error"), dict):
            error = parsed.get("error") if isinstance(parsed.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else "UPSTREAM_ERROR"
            message = (
                error.get("message")
                if isinstance(error.get("message"), str)
                else "Seedream 上游请求失败"
            )
            raise SeedreamUpstreamError(status_code, code, message, request_id)
        return parsed
