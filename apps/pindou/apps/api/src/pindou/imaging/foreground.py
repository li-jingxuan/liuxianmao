"""把增强结果规范化为量化器可安全消费的前景 RGBA 图片。"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from typing import Literal, Protocol

from PIL import Image

from pindou.core.errors import ApiError
from pindou.core.event_log import JSONValue
from pindou.imaging.chroma_key import (
    ChromaPolicy,
    apply_chroma_mask_with_despill,
    build_conservative_edge_key_mask,
    format_chroma_key,
    validate_chroma_mask,
)
from pindou.imaging.solid_alpha import compose_solid_alpha
from pindou.schemas.conversion import BackgroundMode, ConversionStyle, ForegroundFallbackMode
from pindou.services.enhancer import BackgroundHint, EnhancementOptions, ImageEnhancer

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
    """前景准备结果；调用方负责关闭 `image` 和不同对象的 `enhancer_image`。"""

    image: Image.Image
    processing: Literal[
        "none",
        "chroma_matte",
        "hybrid_matte",
        "local_matte",
        "fallback_simplify",
    ]
    confidence: float
    applied_background_mode: BackgroundMode
    enhancer_image: Image.Image | None = None
    degraded: bool = False
    degrade_reason: Literal["foreground_low_confidence"] | None = None
    foreground_model_version: str | None = None
    enhancer_name: str = "passthrough"
    enhancer_model: str | None = None
    enhancer_prompt_version: str | None = None
    diagnostics: dict[str, JSONValue] | None = None


@dataclass(frozen=True, slots=True)
class _ValidatedMask:
    mask: Image.Image
    confidence: float
    metrics: dict[str, float | int | str]


@dataclass(frozen=True, slots=True)
class _MaskValidationFailure:
    """ONNX 蒙版的稳定失败原因和实际观测值。"""

    reasons: tuple[str, ...]
    metrics: dict[str, float | int | str]


@dataclass(frozen=True, slots=True)
class _MaskValidationOutcome:
    validated: _ValidatedMask | None
    failure: _MaskValidationFailure | None


def _validate_mask(
    raw: RawForegroundMask,
    *,
    expected_size: tuple[int, int],
    policy: ForegroundPolicy,
) -> _MaskValidationOutcome:
    """把 Adapter 输出统一为 L 蒙版，并保留低置信的具体原因。"""
    mask = raw.mask.convert("L")
    if mask.size != expected_size:
        resized = mask.resize(expected_size, Image.Resampling.LANCZOS)
        mask.close()
        mask = resized

    pixels = list(mask.get_flattened_data())
    total = len(pixels)
    if total == 0:
        mask.close()
        return _MaskValidationOutcome(
            validated=None,
            failure=_MaskValidationFailure(
                reasons=("foreground_mask_empty",),
                metrics={"foreground_policy_version": policy.version},
            ),
        )

    foreground_coverage = sum(alpha >= policy.foreground_alpha_min for alpha in pixels) / total
    background_coverage = sum(alpha <= policy.background_alpha_max for alpha in pixels) / total
    uncertain_coverage = (
        sum(policy.background_alpha_max < alpha < policy.uncertain_alpha_max for alpha in pixels)
        / total
    )
    metrics: dict[str, float | int | str] = {
        "foreground_coverage": foreground_coverage,
        "min_foreground_coverage": policy.min_foreground_coverage,
        "max_foreground_coverage": policy.max_foreground_coverage,
        "foreground_background_coverage": background_coverage,
        "min_foreground_background_coverage": policy.min_background_coverage,
        "foreground_uncertain_coverage": uncertain_coverage,
        "max_foreground_uncertain_coverage": policy.max_uncertain_coverage,
        "foreground_policy_version": policy.version,
    }
    failures: list[str] = []
    if foreground_coverage < policy.min_foreground_coverage:
        failures.append("foreground_coverage_below_minimum")
    if foreground_coverage > policy.max_foreground_coverage:
        failures.append("foreground_coverage_above_maximum")
    if background_coverage < policy.min_background_coverage:
        failures.append("background_coverage_below_minimum")
    if uncertain_coverage > policy.max_uncertain_coverage:
        failures.append("foreground_uncertain_coverage_above_maximum")
    if failures:
        logger.warning(
            "Foreground mask rejected",
            extra={
                "foreground_model_name": raw.model_name,
                "foreground_model_version": raw.model_version,
                "foreground_validation_failures": failures,
                **metrics,
            },
        )
        mask.close()
        return _MaskValidationOutcome(
            validated=None,
            failure=_MaskValidationFailure(reasons=tuple(failures), metrics=metrics),
        )

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
    return _MaskValidationOutcome(
        validated=_ValidatedMask(
            mask=mask,
            confidence=max(0.0, confidence),
            metrics=metrics,
        ),
        failure=None,
    )


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
        enable_onnx_matting: bool = True,
    ) -> None:
        self._enhancer = enhancer
        self._mask_adapter = mask_adapter
        self._policy = policy or ForegroundPolicy()
        self._enable_onnx_matting = enable_onnx_matting

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
        """增强图片；Solid 始终请求键色，再按配置直接 ONNX 或键色抠图。"""
        enhancement_options = (
            replace(options, background_hint_kind="chroma_key")
            if options.background_mode is BackgroundMode.SOLID
            else options
        )
        enhancement = self._enhancer.enhance(source, options=enhancement_options)
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

        hint = enhancement.background_hint
        if (
            hint is None
            or hint.kind != "chroma_key"
            or hint.policy_version != ChromaPolicy().version
        ):
            if enhanced is not source:
                enhanced.close()
            raise ApiError(
                422,
                "AI_BACKGROUND_SEPARATION_FAILED",
                "Seedream 未生成有效的动态键色协议，无法执行背景分离",
            )

        if not self._enable_onnx_matting:
            return self._prepare_with_chroma(
                source,
                enhanced,
                hint=hint,
                fallback_mode=fallback_mode,
            )

        return self._prepare_with_onnx(
            source,
            enhanced,
            hint=hint,
            fallback_mode=fallback_mode,
        )

    def _prepare_with_onnx(
        self,
        source: Image.Image,
        enhanced: Image.Image,
        *,
        hint: BackgroundHint,
        fallback_mode: ForegroundFallbackMode,
    ) -> PreparedForeground:
        """执行 ONNX 边缘辅助；最终 Alpha 始终由键色保护性合成。"""
        raw = None
        try:
            # ONNX 仅是可选边缘增强；模型不可用时仍应尝试合格的键色路径。
            try:
                raw = self._mask_adapter.generate(enhanced)
            except Exception:
                logger.warning("ONNX edge assist unavailable; using protected chroma", exc_info=True)
            outcome = compose_solid_alpha(enhanced, hint, raw.mask if raw is not None else None)
        except Exception:
            if enhanced is not source:
                enhanced.close()
            raise
        finally:
            if raw is not None:
                raw.mask.close()
        if outcome.result is not None:
            result = outcome.result
            try:
                output = _apply_mask(enhanced, result.mask)
            finally:
                result.mask.close()
            return PreparedForeground(
                image=output,
                processing="hybrid_matte" if result.strategy.endswith("onnx_edge") else "chroma_matte",
                confidence=result.confidence,
                applied_background_mode=BackgroundMode.SOLID,
                enhancer_image=enhanced,
                foreground_model_version=self._mask_adapter.model_version,
                enhancer_name=self._enhancer.name,
                enhancer_model=self._enhancer.model,
                enhancer_prompt_version=self._enhancer.prompt_version,
                diagnostics=result.metrics,
            )
        if fallback_mode is ForegroundFallbackMode.SIMPLIFY:
            if enhanced is not source:
                enhanced.close()
            raise ApiError(422, "AI_BACKGROUND_SEPARATION_FAILED", "键色背景无法安全移除")
        if enhanced is not source:
            enhanced.close()
        raise ApiError(422, "AI_BACKGROUND_SEPARATION_FAILED", "未能可靠识别主体，请改用保留/简化背景")

    def _prepare_with_chroma(
        self,
        source: Image.Image,
        enhanced: Image.Image,
        *,
        hint: BackgroundHint | None,
        fallback_mode: ForegroundFallbackMode,
    ) -> PreparedForeground:
        """验证 Seedream 动态键色并生成蒙版，全程不得调用 ONNX Adapter。"""
        chroma = None
        validation = None
        if hint is not None:
            try:
                validation = validate_chroma_mask(enhanced, hint)
                chroma = validation.result
            except Exception:
                if enhanced is not source:
                    enhanced.close()
                raise
        if chroma is not None:
            try:
                output = apply_chroma_mask_with_despill(
                    enhanced,
                    chroma.mask,
                    chroma.actual_key_rgb,
                )
            except Exception:
                if enhanced is not source:
                    enhanced.close()
                raise
            finally:
                chroma.mask.close()
            logger.info(
                "Foreground prepared with validated chroma",
                extra={
                    "foreground_processing": "chroma_matte",
                    "foreground_confidence": chroma.confidence,
                    **chroma.metrics,
                },
            )
            return PreparedForeground(
                image=output,
                processing="chroma_matte",
                confidence=chroma.confidence,
                applied_background_mode=BackgroundMode.SOLID,
                enhancer_image=enhanced,
                enhancer_name=self._enhancer.name,
                enhancer_model=self._enhancer.model,
                enhancer_prompt_version=self._enhancer.prompt_version,
                diagnostics=chroma.metrics,
            )

        # 未携带或版本不匹配的 Hint 无法证明背景颜色，不能因为请求了 simplify
        # 就猜测透明色；保持既有 422 错误语义，避免未知颜色进入背景协议。
        if (
            hint is None
            or hint.kind != "chroma_key"
            or hint.policy_version != ChromaPolicy().version
        ):
            if enhanced is not source:
                enhanced.close()
            raise ApiError(
                422,
                "AI_BACKGROUND_SEPARATION_FAILED",
                "Seedream 未生成可验证的动态键色背景，请改用保留/简化背景或开启 ONNX",
            )

        if fallback_mode is ForegroundFallbackMode.SIMPLIFY:
            # 完整验证失败时仍执行最小键色协议：只透明化边缘连通近键色，避免
            # 将 Seedream 的内部键色当作普通前景豆子统计；结果仍标记为降级。
            conservative = None
            if hint is not None:
                try:
                    conservative = build_conservative_edge_key_mask(enhanced, hint)
                except Exception:
                    if enhanced is not source:
                        enhanced.close()
                    raise
            if conservative is not None:
                # 降级蒙版与完整验证属于两个阶段：保留蒙版指标的同时，
                # 以完整验证的观测值解释为什么进入 fallback_simplify。
                diagnostics: dict[str, JSONValue] = dict(conservative.metrics)
                if validation is not None and validation.failure is not None:
                    diagnostics.update(validation.failure.metrics)
                    diagnostics["validation_failures"] = list(validation.failure.reasons)
                try:
                    output = apply_chroma_mask_with_despill(
                        enhanced,
                        conservative.mask,
                        conservative.actual_key_rgb,
                    )
                except Exception:
                    if enhanced is not source:
                        enhanced.close()
                    raise
                finally:
                    conservative.mask.close()
                logger.warning(
                    "Foreground low confidence; applied conservative chroma fallback",
                    extra={
                        "foreground_processing": "fallback_simplify",
                        **diagnostics,
                    },
                )
                return PreparedForeground(
                    image=output,
                    processing="fallback_simplify",
                    confidence=0.0,
                    applied_background_mode=BackgroundMode.SIMPLIFY,
                    enhancer_image=enhanced,
                    degraded=True,
                    degrade_reason="foreground_low_confidence",
                    enhancer_name=self._enhancer.name,
                    enhancer_model=self._enhancer.model,
                    enhancer_prompt_version=self._enhancer.prompt_version,
                    diagnostics=diagnostics,
                )
            return PreparedForeground(
                image=enhanced,
                processing="fallback_simplify",
                confidence=0.0,
                applied_background_mode=BackgroundMode.SIMPLIFY,
                degraded=True,
                degrade_reason="foreground_low_confidence",
                enhancer_name=self._enhancer.name,
                enhancer_model=self._enhancer.model,
                enhancer_prompt_version=self._enhancer.prompt_version,
            )
        if enhanced is not source:
            enhanced.close()
        raise ApiError(
            422,
            "AI_BACKGROUND_SEPARATION_FAILED",
            "Seedream 未生成可验证的动态键色背景，请改用保留/简化背景或开启 ONNX",
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


class DisabledForegroundMaskAdapter:
    """ONNX 关闭时的无资源 Adapter；任何推理调用都视为编排错误。"""

    name = "disabled"
    model_version = "disabled"
    ready = False

    def generate(self, image: Image.Image) -> RawForegroundMask:
        del image
        raise RuntimeError("ONNX matting is disabled")
