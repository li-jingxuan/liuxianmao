"""Pillow 图片与 Seedream 5.0 lite 之间的安全适配器。"""

from __future__ import annotations

import base64
from io import BytesIO
from threading import BoundedSemaphore
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError

from pindou.core.errors import ApiError
from pindou.services.enhancer import EnhancementOptions, EnhancementResult
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

    def enhance(
        self,
        image: Image.Image,
        *,
        options: EnhancementOptions,
    ) -> EnhancementResult:
        """限制输入尺寸、调用方舟，并记录上游实际返回的 Alpha 状态。"""
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
            # 这里只负责识别上游结果，不在增强器内抠除背景；背景策略属于 API
            # 领域后处理，便于 passthrough 与 Seedream 共享同一套规则。
            output, alpha_status = self._decode_output(result.image_bytes)
            return EnhancementResult(image=output, background_alpha_status=alpha_status)
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

    def _decode_output(
        self,
        content: bytes,
    ) -> tuple[Image.Image, Literal["transparent", "opaque", "absent"]]:
        """不信任上游声明尺寸，并确认 RGBA 转换前是否真实存在 Alpha。"""
        try:
            with Image.open(BytesIO(content)) as source:
                if source.width * source.height > self._output_max_pixels:
                    raise ApiError(502, "AI_UPSTREAM_ERROR", "AI 返回图片超过像素限制")
                source.load()
                # 必须在 convert("RGBA") 之前检查：Pillow 转换后所有图片都会有 A
                # 通道，不能据此证明上游真的返回了透明背景。
                has_alpha_channel = "A" in source.getbands()
                transposed = ImageOps.exif_transpose(source)
                output = transposed.convert("RGBA")
                if not has_alpha_channel:
                    # JPEG/RGB 等格式没有 Alpha；转换后的 A=255 只是类型统一结果。
                    alpha_status: Literal["transparent", "opaque", "absent"] = "absent"
                else:
                    alpha = output.getchannel("A")
                    try:
                        # 只要存在低于量化占用阈值的像素，就认为上游提供了可用透明区域；
                        # 全 255 的 PNG 仍按 opaque 处理，继续走边缘背景抠除。
                        alpha_status = "transparent" if alpha.getextrema()[0] < 128 else "opaque"
                    finally:
                        alpha.close()
                return output, alpha_status
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
