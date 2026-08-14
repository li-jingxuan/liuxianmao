"""Pillow 图片与 Seedream 5.0 lite 之间的安全适配器。"""

from __future__ import annotations

import base64
from io import BytesIO
from threading import BoundedSemaphore

from PIL import Image, ImageOps, UnidentifiedImageError

from pindou.core.errors import ApiError
from pindou.services.enhancer import EnhancementOptions
from pindou.services.seedream_client import SeedreamClient, SeedreamUpstreamError
from pindou.services.seedream_prompt import build_seedream_prompt


class SeedreamEnhancer:
    """将原图简化为适合后续 MARD 量化的中间图。"""

    def __init__(
        self,
        *,
        client: SeedreamClient,
        model: str,
        prompt_version: str,
        input_max_edge: int,
        output_max_pixels: int,
        max_concurrency: int,
        queue_timeout_seconds: float,
    ) -> None:
        self._client = client
        self._model = model
        self._prompt_version = prompt_version
        self._input_max_edge = input_max_edge
        self._output_max_pixels = output_max_pixels
        self._semaphore = BoundedSemaphore(max_concurrency)
        self._queue_timeout_seconds = queue_timeout_seconds

    @property
    def name(self) -> str:
        return "seedream-5-lite"

    @property
    def model(self) -> str:
        return self._model

    @property
    def prompt_version(self) -> str:
        return self._prompt_version

    def close(self) -> None:
        self._client.close()

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> Image.Image:
        """限制输入尺寸、调用方舟，并将上游结果安全解码为 RGBA。"""
        acquired = self._semaphore.acquire(timeout=self._queue_timeout_seconds)
        if not acquired:
            raise ApiError(429, "AI_BUSY", "AI 服务忙，请稍后重试")
        try:
            data_url = self._encode_image_data_url(image)
            prompt = build_seedream_prompt(options)
            try:
                result = self._client.edit_image(image_data_url=data_url, prompt=prompt)
            except SeedreamUpstreamError as exc:
                raise self._map_upstream_error(exc) from exc
            output = self._decode_output(result.image_bytes)
            return output
        finally:
            self._semaphore.release()

    def _encode_image_data_url(self, image: Image.Image) -> str:
        """用 PNG 保留 Alpha，缩小过大输入并不携带 EXIF/GPS。"""
        prepared = image.copy()
        try:
            prepared.thumbnail(
                (self._input_max_edge, self._input_max_edge),
                resample=Image.Resampling.LANCZOS,
            )
            output = BytesIO()
            prepared.save(output, format="PNG", optimize=True)
            encoded = base64.b64encode(output.getvalue()).decode("ascii")
            return f"data:image/png;base64,{encoded}"
        finally:
            prepared.close()

    def _decode_output(self, content: bytes) -> Image.Image:
        """不信任上游声明尺寸，解码前后都执行像素限制。"""
        try:
            with Image.open(BytesIO(content)) as source:
                if source.width * source.height > self._output_max_pixels:
                    raise ApiError(502, "AI_UPSTREAM_ERROR", "AI 返回图片超过像素限制")
                source.load()
                transposed = ImageOps.exif_transpose(source)
                return transposed.convert("RGBA")
        except ApiError:
            raise
        except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise ApiError(502, "AI_UPSTREAM_ERROR", "AI 返回图片无法解码") from exc

    @staticmethod
    def _map_upstream_error(exc: SeedreamUpstreamError) -> ApiError:
        if exc.code == "InputTextSensitiveContentDetected":
            return ApiError(400, "AI_INPUT_REJECTED", "图片或处理指令未通过内容安全检查")
        if exc.code == "OutputImageSensitiveContentDetected":
            return ApiError(422, "AI_OUTPUT_REJECTED", "AI 生成结果未通过内容安全检查")
        if exc.code == "QuotaExceeded" or exc.status_code == 429:
            return ApiError(429, "AI_BUSY", "AI 服务忙，请稍后重试")
        if exc.status_code == 504 or exc.code == "TIMEOUT":
            return ApiError(504, "AI_TIMEOUT", "AI 处理超时，请稍后手动重试")
        return ApiError(502, "AI_UPSTREAM_ERROR", "AI 服务暂时不可用")
