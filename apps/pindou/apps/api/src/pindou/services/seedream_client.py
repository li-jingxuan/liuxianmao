"""火山方舟 Ark Python SDK 的 Seedream 窄适配层。"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Protocol

from volcenginesdkarkruntime._exceptions import (
    ArkAPIConnectionError,
    ArkAPIError,
    ArkAPIStatusError,
    ArkAPITimeoutError,
)


class _ImagesResource(Protocol):
    def generate(self, **kwargs: object) -> object: ...


class ArkClientProtocol(Protocol):
    """只暴露项目实际使用的 Ark SDK 表面，便于以稳定 fake 测试。"""

    images: _ImagesResource

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class SeedreamResult:
    """上游成功生成的单张图片及可观测元数据。"""

    image_bytes: bytes
    model: str
    size: str | None
    generated_images: int
    upstream_request_id: str | None


class SeedreamUpstreamError(Exception):
    """不包含请求图片和密钥的稳定项目异常。"""

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
    """把官方 Ark SDK 收窄为单参考图、单图 Base64 输出契约。"""

    def __init__(
        self,
        *,
        client: ArkClientProtocol,
        model: str,
        image_size: str,
        watermark: bool,
        max_response_bytes: int,
    ) -> None:
        self._client = client
        self._model = model
        self._image_size = image_size
        self._watermark = watermark
        self._max_response_bytes = max_response_bytes
        self._closed = False

    def close(self) -> None:
        """幂等关闭 SDK 连接池，由 FastAPI lifespan 调用。"""
        if self._closed:
            return
        self._client.close()
        self._closed = True

    def edit_image(
        self,
        *,
        model: str | None = None,
        image_data_url: str,
        prompt: str,
        background: str | None = None,
    ) -> SeedreamResult:
        """通过 Ark SDK 发起非流式单图编辑并严格验证响应对象。"""
        request: dict[str, object] = {
            "model": model or self._model,
            "prompt": prompt,
            "image": image_data_url,
            "size": self._image_size,
            "response_format": "b64_json",
            "output_format": "png",
            "watermark": self._watermark,
        }
        if background is not None:
            # SDK 5.0.47 尚未把 background 暴露成命名参数，但官方扩展口会把该字段
            # 合并进 JSON body。升级到带正式参数的 SDK 后可直接替换，不影响业务层。
            request["extra_body"] = {"background": background}

        try:
            response = self._client.images.generate(**request)
        except ArkAPITimeoutError as exc:
            raise SeedreamUpstreamError(
                504,
                "TIMEOUT",
                "Seedream 请求超时",
                getattr(exc, "request_id", None),
            ) from exc
        except ArkAPIStatusError as exc:
            raise SeedreamUpstreamError(
                exc.status_code,
                self._extract_error_code(exc),
                exc.message,
                exc.request_id,
            ) from exc
        except ArkAPIConnectionError as exc:
            raise SeedreamUpstreamError(
                502,
                "NETWORK_ERROR",
                "Seedream 网络请求失败",
                getattr(exc, "request_id", None),
            ) from exc
        except ArkAPIError as exc:
            raise SeedreamUpstreamError(
                502,
                exc.code or "SDK_ERROR",
                "Seedream SDK 调用失败",
                getattr(exc, "request_id", None),
            ) from exc
        except Exception as exc:
            raise SeedreamUpstreamError(502, "SDK_ERROR", "Seedream SDK 调用失败") from exc

        data = getattr(response, "data", None)
        if not isinstance(data, list) or len(data) != 1:
            raise SeedreamUpstreamError(502, "INVALID_RESPONSE", "Seedream 未返回唯一图片")
        item = data[0]
        encoded = getattr(item, "b64_json", None)
        if not isinstance(encoded, str) or not encoded:
            raise SeedreamUpstreamError(502, "INVALID_RESPONSE", "Seedream 响应缺少 b64_json")
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise SeedreamUpstreamError(502, "INVALID_IMAGE", "Seedream 返回了无效图片") from exc
        if len(image_bytes) > self._max_response_bytes:
            raise SeedreamUpstreamError(502, "RESPONSE_TOO_LARGE", "Seedream 图片超过大小限制")

        usage = getattr(response, "usage", None)
        generated_images = getattr(usage, "generated_images", 1)
        model = getattr(response, "model", None)
        size = getattr(item, "size", None)
        request_id = getattr(response, "_request_id", None)
        return SeedreamResult(
            image_bytes=image_bytes,
            model=model if isinstance(model, str) and model else self._model,
            size=size if isinstance(size, str) else None,
            generated_images=generated_images if isinstance(generated_images, int) else 1,
            upstream_request_id=request_id if isinstance(request_id, str) else None,
        )

    @staticmethod
    def _extract_error_code(exc: ArkAPIStatusError) -> str:
        """兼容 Ark SDK 顶层及标准嵌套 error.code 响应结构。"""
        if isinstance(exc.code, str) and exc.code:
            return exc.code
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                code = error.get("code")
                if isinstance(code, str) and code:
                    return code
        return "UPSTREAM_ERROR"
