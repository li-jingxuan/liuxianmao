"""Pillow 图片与 Seedream 5.0 lite 之间的安全适配器。"""

from __future__ import annotations

import base64
import logging
from io import BytesIO
from pathlib import Path
from threading import BoundedSemaphore

from PIL import Image, ImageOps, UnidentifiedImageError

from pindou.core.errors import ApiError
from pindou.core.ark_errors import map_ark_error
from pindou.core.event_log import write_event_log
from pindou.imaging.image_backup import save_seedream_response_bytes
from pindou.imaging.seedream_input import prepare_transparent_input
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import EnhancementOptions, EnhancementResult, NativeAlphaHint
from pindou.services.seedream_client import SeedreamClient, SeedreamUpstreamError
from pindou.services.seedream_prompt import SEEDREAM_PROMPT_VERSION, build_seedream_prompt

SEEDREAM_STYLES = frozenset(ConversionStyle)
# Uvicorn 默认只为自身 logger 安装终端 handler，普通模块 INFO logger 会被静默过滤。
# 复用 `uvicorn.error` 的终端 handler，确保开发模式下完整 Prompt 确实显示在启动终端。
logger = logging.getLogger("uvicorn.error")


class SeedreamEnhancer:
    """将原图简化为适合后续 MARD 量化的中间图。"""

    def __init__(
        self,
        *,
        client: SeedreamClient,
        model: str,
        model_pro: str | None = None,
        model_lite: str | None = None,
        input_max_edge: int,
        output_max_pixels: int,
        max_concurrency: int,
        queue_timeout_seconds: float,
        log_prompts: bool = False,
        image_backup_dir: Path | None = None,
        event_log_dir: Path | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._model_pro = model_pro or model
        self._model_lite = model_lite or model
        self._input_max_edge = input_max_edge
        self._output_max_pixels = output_max_pixels
        self._semaphore = BoundedSemaphore(max_concurrency)
        self._queue_timeout_seconds = queue_timeout_seconds
        # 仅由开发环境注入；生产环境默认关闭，避免把用户图片上下文记录到日志。
        self._log_prompts = log_prompts
        self._image_backup_dir = image_backup_dir
        self._event_log_dir = event_log_dir

    @property
    def name(self) -> str:
        return "seedream-5"

    @property
    def model(self) -> str:
        return self._model

    @property
    def prompt_version(self) -> str:
        """返回与当前 Prompt 实现绑定的唯一版本号。"""
        return SEEDREAM_PROMPT_VERSION

    @property
    def supported_styles(self) -> frozenset[ConversionStyle]:
        return SEEDREAM_STYLES

    def close(self) -> None:
        self._client.close()

    def enhance(
        self,
        image: Image.Image,
        *,
        options: EnhancementOptions,
    ) -> EnhancementResult:
        """限制输入尺寸、调用方舟，并声明上游是否携带原生 Alpha。"""
        if options.conversion_style not in self.supported_styles:
            raise ApiError(
                503,
                "CONVERSION_STYLE_UNAVAILABLE",
                "当前转换类型暂不可用，请选择原图增强后重试",
            )
        acquired = self._semaphore.acquire(timeout=self._queue_timeout_seconds)
        if not acquired:
            raise ApiError(429, "AI_BUSY", "AI 服务忙，请稍后重试")
        try:
            data_url = self._encode_image_data_url(image)
            prompt = build_seedream_prompt(options)
            if self._log_prompts:
                # 开发环境才记录完整提示词，避免生产日志长期保留用户图片上下文。
                logger.info("Seedream prompt (development):\n%s", prompt)
            request_model = self._model_pro if options.background_mode is BackgroundMode.SOLID else self._model_lite
            try:
                result = self._client.edit_image(
                    model=request_model,
                    image_data_url=data_url,
                    prompt=prompt,
                    background=(
                        "transparent"
                        if options.background_mode is BackgroundMode.SOLID
                        else None
                    ),
                )
            except SeedreamUpstreamError as exc:
                self._log_upstream_failure(exc, options=options)
                raise self._map_upstream_error(exc) from exc
            # Ark 已返回成功结果即落盘，确保即使后续 PNG 解码或 ONNX 兜底失败，
            # images/ 中仍保留供应商原始产物用于排查。
            if self._image_backup_dir is not None:
                save_seedream_response_bytes(
                    result.image_bytes,
                    directory=self._image_backup_dir,
                )
            # Solid 只要求上游 PNG 容器携带 Alpha；本版本信任模型透明背景结果，
            # 不在本地对 Alpha 覆盖率或边缘连通性做质量判定。
            output, has_native_alpha = self._decode_output(result.image_bytes)
            hint = (
                NativeAlphaHint()
                if options.background_mode is BackgroundMode.SOLID and has_native_alpha
                else None
            )
            return EnhancementResult(image=output, background_hint=hint, model=request_model)
        finally:
            self._semaphore.release()

    def _encode_image_data_url(self, image: Image.Image) -> str:
        """生成带左上角透明像素的 PNG 数据 URL，不携带 EXIF/GPS。"""
        prepared = prepare_transparent_input(image, max_edge=self._input_max_edge)
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

    def _decode_output(self, content: bytes) -> tuple[Image.Image, bool]:
        """验证实际 PNG、像素上限和原始透明信息，再返回独立 RGBA。"""
        try:
            with Image.open(BytesIO(content)) as source:
                if source.format != "PNG":
                    raise ApiError(502, "AI_UPSTREAM_ERROR", "AI 返回图片不是 PNG")
                if source.width * source.height > self._output_max_pixels:
                    raise ApiError(502, "AI_UPSTREAM_ERROR", "AI 返回图片超过像素限制")
                source.load()
                has_native_alpha = "A" in source.getbands() or "transparency" in source.info
                transposed = ImageOps.exif_transpose(source)
                output = transposed.convert("RGBA")
                return output, has_native_alpha
        except ApiError:
            raise
        except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise ApiError(502, "AI_UPSTREAM_ERROR", "AI 返回图片无法解码") from exc

    @staticmethod
    def _map_upstream_error(exc: SeedreamUpstreamError) -> ApiError:
        return map_ark_error(exc)

    def _log_upstream_failure(
        self,
        exc: SeedreamUpstreamError,
        *,
        options: EnhancementOptions,
    ) -> None:
        """记录 Ark 原始失败上下文；不写入图片、Prompt 或密钥。"""
        payload = {
            "provider": "ark",
            "model": self._model,
            "upstream_status_code": exc.status_code,
            "upstream_code": exc.code,
            "upstream_request_id": exc.request_id,
            "upstream_message": exc.message[:1000],
            "conversion_style": options.conversion_style.value,
            "background_mode": options.background_mode.value,
            "grid_size": options.grid_size,
        }
        logger.error("Ark Seedream request failed", extra=payload)
        if self._event_log_dir is None:
            return
        try:
            write_event_log("ark_upstream_failure", payload, directory=self._event_log_dir)
        except Exception:
            logger.exception("Failed to persist Ark upstream failure event")
