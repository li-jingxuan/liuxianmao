"""把增强结果规范化为量化器可安全消费的前景 RGBA 图片。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Protocol

from PIL import Image

from pindou.core.errors import ApiError
from pindou.schemas.conversion import BackgroundMode, ConversionStyle, ForegroundFallbackMode
from pindou.services.enhancer import EnhancementOptions, ImageEnhancer

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ForegroundPolicy:
    """集中定义蒙版成功语义，避免 Adapter 和路由各自维护阈值。"""

    version: str = "foreground-v1"
    min_foreground_coverage: float = 0.01
    max_foreground_coverage: float = 0.95
    min_background_coverage: float = 0.01
    max_uncertain_coverage: float = 0.65
    background_alpha_max: int = 32
    foreground_alpha_min: int = 128
    uncertain_alpha_max: int = 224


@dataclass(frozen=True, slots=True)
class RawForegroundMask:
    """Adapter 的原始软蒙版；统一验证器拥有并负责关闭 `mask`。"""

    mask: Image.Image
    model_name: str
    model_version: str


class ForegroundMaskAdapter(Protocol):
    """本地前景模型的内部 seam；生产和测试各有一个 Adapter。"""

    @property
    def name(self) -> str: ...

    @property
    def model_version(self) -> str: ...

    @property
    def ready(self) -> bool: ...

    def generate(self, image: Image.Image) -> RawForegroundMask: ...


@dataclass(frozen=True, slots=True)
class PreparedForeground:
    """前景准备深模块的稳定结果，调用方拥有并负责关闭 `image`。"""

    image: Image.Image
    processing: Literal["none", "local_matte", "fallback_simplify"]
    confidence: float
    applied_background_mode: BackgroundMode
    degraded: bool = False
    degrade_reason: Literal["foreground_low_confidence"] | None = None
    foreground_model_version: str | None = None
    enhancer_name: str = "passthrough"
    enhancer_model: str | None = None
    enhancer_prompt_version: str | None = None


@dataclass(frozen=True, slots=True)
class _ValidatedMask:
    mask: Image.Image
    confidence: float


def _validate_mask(
    raw: RawForegroundMask,
    *,
    expected_size: tuple[int, int],
    policy: ForegroundPolicy,
) -> _ValidatedMask | None:
    """把任意 Adapter 输出统一为 L 软蒙版，并验证覆盖率与不确定区域。"""
    mask = raw.mask.convert("L")
    if mask.size != expected_size:
        resized = mask.resize(expected_size, Image.Resampling.LANCZOS)
        mask.close()
        mask = resized

    pixels = list(mask.get_flattened_data())
    total = len(pixels)
    if total == 0:
        mask.close()
        return None

    foreground_coverage = sum(
        alpha >= policy.foreground_alpha_min for alpha in pixels
    ) / total
    background_coverage = sum(alpha <= policy.background_alpha_max for alpha in pixels) / total
    uncertain_coverage = sum(
        policy.background_alpha_max < alpha < policy.uncertain_alpha_max for alpha in pixels
    ) / total
    valid = (
        policy.min_foreground_coverage
        <= foreground_coverage
        <= policy.max_foreground_coverage
        and background_coverage >= policy.min_background_coverage
        and uncertain_coverage <= policy.max_uncertain_coverage
    )
    if not valid:
        logger.warning(
            "Foreground mask rejected",
            extra={
                "foreground_model_name": raw.model_name,
                "foreground_model_version": raw.model_version,
                "foreground_coverage": foreground_coverage,
                "background_coverage": background_coverage,
                "foreground_uncertain_coverage": uncertain_coverage,
                "foreground_policy_version": policy.version,
            },
        )
        mask.close()
        return None

    foreground_margin = min(
        foreground_coverage / policy.min_foreground_coverage,
        (1.0 - foreground_coverage) / (1.0 - policy.max_foreground_coverage),
    )
    confidence = min(
        1.0,
        foreground_margin,
        background_coverage / policy.min_background_coverage,
        1.0 - uncertain_coverage,
    )
    return _ValidatedMask(mask=mask, confidence=max(0.0, confidence))


def _apply_mask(image: Image.Image, mask: Image.Image) -> Image.Image:
    """保留增强图 RGB，并以模型软蒙版作为唯一 Alpha。"""
    output = image.convert("RGBA")
    output.putalpha(mask)
    return output


class ForegroundPreparer:
    """隐藏增强、模型推理、质量验证、降级和 Pillow 生命周期的深模块。"""

    def __init__(
        self,
        *,
        enhancer: ImageEnhancer,
        mask_adapter: ForegroundMaskAdapter,
        policy: ForegroundPolicy | None = None,
    ) -> None:
        self._enhancer = enhancer
        self._mask_adapter = mask_adapter
        self._policy = policy or ForegroundPolicy()

    @property
    def supported_styles(self) -> frozenset[ConversionStyle]:
        """向编排层公开增强器能力，同时隐藏具体供应商实现。"""
        return self._enhancer.supported_styles

    @property
    def enhancer_name(self) -> str:
        """供结构化日志标记当前增强器，不让路由判断具体名称。"""
        return self._enhancer.name

    def prepare(
        self,
        source: Image.Image,
        *,
        options: EnhancementOptions,
        fallback_mode: ForegroundFallbackMode = ForegroundFallbackMode.NONE,
    ) -> PreparedForeground:
        """增强图片；Solid 始终执行本地模型，低置信时按显式策略降级。"""
        enhancement = self._enhancer.enhance(source, options=options)
        enhanced = enhancement.image
        if options.background_mode is not BackgroundMode.SOLID:
            return PreparedForeground(
                image=enhanced,
                processing="none",
                confidence=1.0,
                applied_background_mode=options.background_mode,
                enhancer_name=self._enhancer.name,
                enhancer_model=self._enhancer.model,
                enhancer_prompt_version=self._enhancer.prompt_version,
            )

        try:
            raw = self._mask_adapter.generate(enhanced)
            try:
                validated = _validate_mask(
                    raw,
                    expected_size=enhanced.size,
                    policy=self._policy,
                )
            finally:
                raw.mask.close()
        except Exception:
            if enhanced is not source:
                enhanced.close()
            raise

        if validated is not None:
            try:
                output = _apply_mask(enhanced, validated.mask)
            finally:
                validated.mask.close()
                if enhanced is not source:
                    enhanced.close()
            logger.info(
                "Foreground prepared with local model",
                extra={
                    "foreground_processing": "local_matte",
                    "foreground_confidence": validated.confidence,
                    "foreground_model_name": self._mask_adapter.name,
                    "foreground_model_version": self._mask_adapter.model_version,
                    "foreground_policy_version": self._policy.version,
                },
            )
            return PreparedForeground(
                image=output,
                processing="local_matte",
                confidence=validated.confidence,
                applied_background_mode=BackgroundMode.SOLID,
                foreground_model_version=self._mask_adapter.model_version,
                enhancer_name=self._enhancer.name,
                enhancer_model=self._enhancer.model,
                enhancer_prompt_version=self._enhancer.prompt_version,
            )

        if fallback_mode is ForegroundFallbackMode.SIMPLIFY:
            logger.warning(
                "Foreground low confidence; returning explicit simplify fallback",
                extra={
                    "foreground_processing": "fallback_simplify",
                    "foreground_model_name": self._mask_adapter.name,
                    "foreground_model_version": self._mask_adapter.model_version,
                    "foreground_policy_version": self._policy.version,
                },
            )
            return PreparedForeground(
                image=enhanced,
                processing="fallback_simplify",
                confidence=0.0,
                applied_background_mode=BackgroundMode.SIMPLIFY,
                degraded=True,
                degrade_reason="foreground_low_confidence",
                foreground_model_version=self._mask_adapter.model_version,
                enhancer_name=self._enhancer.name,
                enhancer_model=self._enhancer.model,
                enhancer_prompt_version=self._enhancer.prompt_version,
            )

        if enhanced is not source:
            enhanced.close()
        raise ApiError(
            422,
            "AI_BACKGROUND_SEPARATION_FAILED",
            "未能可靠识别主体，请改用保留/简化背景，或允许自动降级为简化背景",
        )


class UnavailableForegroundMaskAdapter:
    """只供测试环境验证系统故障语义，生产配置禁止使用。"""

    name = "unavailable"
    model_version = "unavailable"
    ready = False

    def generate(self, image: Image.Image) -> RawForegroundMask:
        del image
        raise ApiError(
            503,
            "FOREGROUND_MASK_UNAVAILABLE",
            "主体识别能力暂时不可用，请稍后重试",
        )
