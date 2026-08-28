from __future__ import annotations

import pytest
from PIL import Image

from pindou.core.errors import ApiError
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import ForegroundPreparer, RawForegroundMask
from pindou.schemas.conversion import (
    BackgroundMode,
    ConversionStyle,
    ForegroundFallbackMode,
)
from pindou.services.enhancer import BackgroundHint, EnhancementOptions, EnhancementResult


class _OpaqueEnhancer:
    name = "test-enhancer"
    model = "test-model"
    prompt_version = "test-prompt"
    supported_styles = frozenset(ConversionStyle)
    last_options: EnhancementOptions | None = None

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        type(self).last_options = options
        return EnhancementResult(
            image=image.convert("RGBA"),
            background_hint=(
                BackgroundHint("chroma_key", (0, 255, 0), "solid-chroma-v1")
                if options.background_hint_kind == "chroma_key"
                else None
            ),
        )


class _MissingHintEnhancer(_OpaqueEnhancer):
    """模拟 Seedream 适配器违反键色协议，不返回 BackgroundHint。"""

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        type(self).last_options = options
        return EnhancementResult(image=image.convert("RGBA"))


class _CenterMaskAdapter:
    name = "test-mask"
    model_version = "test-v1"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        mask = Image.new("L", image.size, 0)
        for x in range(2, image.width - 2):
            for y in range(2, image.height - 2):
                mask.putpixel((x, y), 255)
        return RawForegroundMask(mask, self.name, self.model_version)


class _ConstantMaskAdapter:
    name = "test-constant"
    model_version = "test-v1"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        return RawForegroundMask(
            Image.new("L", image.size, 255),
            self.name,
            self.model_version,
        )


class _InverseMaskAdapter:
    """构造与键色主体语义故意冲突、但全局指标合法的 ONNX 蒙版。"""

    name = "test-inverse"
    model_version = "test-v1"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        mask = Image.new("L", image.size, 255)
        for x in range(3, image.width - 3):
            for y in range(3, image.height - 3):
                mask.putpixel((x, y), 0)
        return RawForegroundMask(mask, self.name, self.model_version)


class _UnavailableMaskAdapter:
    name = "test-unavailable"
    model_version = "test-v1"
    ready = False

    def generate(self, image: Image.Image) -> RawForegroundMask:
        del image
        raise ApiError(503, "FOREGROUND_MASK_UNAVAILABLE", "unavailable")


class _ChromaEnhancer:
    """构造确定性键色背景，模拟 Seedream 已遵循 Solid Prompt。"""

    name = "test-chroma-enhancer"
    model = "test-model"
    prompt_version = "test-chroma"
    supported_styles = frozenset(ConversionStyle)

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del options
        output = Image.new("RGBA", image.size, (0, 255, 0, 255))
        for x in range(3, image.width - 3):
            for y in range(3, image.height - 3):
                output.putpixel((x, y), (220, 30, 30, 255))
        return EnhancementResult(
            image=output,
            background_hint=BackgroundHint(
                kind="chroma_key",
                requested_color=(0, 255, 0),
                policy_version="solid-chroma-v1",
            ),
        )


class _ExplodingMaskAdapter:
    """动态键色路径若误调 ONNX，立即让契约测试失败。"""

    name = "test-exploding"
    model_version = "test-v1"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        del image
        raise AssertionError("关闭 ONNX 后不应调用 Mask Adapter")


class _ChromaLowCoverageEnhancer:
    """让完整键色校验因背景覆盖率过高失败，但仍保留可识别的边缘键色。"""

    name = "test-chroma-low-coverage"
    model = "test-model"
    prompt_version = "test-chroma"
    supported_styles = frozenset(ConversionStyle)

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del options
        output = Image.new("RGBA", image.size, (220, 30, 30, 255))
        # 仅保留顶部边缘键色，令完整校验因触边边数不足而失败。
        for x in range(image.width):
            output.putpixel((x, 0), (0, 255, 0, 255))
        # 中心孤立键色像素保持主体语义，验证算法不会全图近色透明。
        output.putpixel((image.width // 2, image.height // 2), (0, 255, 0, 255))
        output.putpixel((image.width // 2 - 1, image.height // 2), (220, 30, 30, 255))
        return EnhancementResult(
            image=output,
            background_hint=BackgroundHint(
                kind="chroma_key",
                requested_color=(0, 255, 0),
                policy_version="solid-chroma-v1",
            ),
        )


def _options(mode: BackgroundMode = BackgroundMode.SOLID) -> EnhancementOptions:
    return EnhancementOptions(
        grid_size=52,
        color_budget_band=ColorBudgetBand.BALANCED,
        background_mode=mode,
        conversion_style=ConversionStyle.ORIGINAL,
        background_color="#FFFFFF" if mode is BackgroundMode.SOLID else None,
    )


def test_enabled_onnx_requests_chroma_key_and_uses_local_foreground_mask() -> None:
    source = Image.new("RGBA", (12, 12), (255, 255, 255, 255))
    preparer = ForegroundPreparer(
        enhancer=_OpaqueEnhancer(),
        mask_adapter=_CenterMaskAdapter(),
    )
    try:
        prepared = preparer.prepare(source, options=_options())
        try:
            assert prepared.processing == "local_matte"
            assert prepared.applied_background_mode is BackgroundMode.SOLID
            assert prepared.foreground_model_version == "test-v1"
            assert prepared.enhancer_image is not None
            assert prepared.enhancer_image is not prepared.image
            assert prepared.enhancer_image.getpixel((0, 0))[3] == 255
            assert prepared.image.getpixel((0, 0))[3] == 0
            assert prepared.image.getpixel((6, 6))[3] == 255
            assert _OpaqueEnhancer.last_options is not None
            assert _OpaqueEnhancer.last_options.background_hint_kind == "chroma_key"
        finally:
            prepared.image.close()
            assert prepared.enhancer_image is not None
            prepared.enhancer_image.close()
    finally:
        source.close()


def test_enabled_onnx_alpha_comes_directly_from_onnx_mask() -> None:
    """成功路径不用键色蒙版修正 ONNX，即使两者的主体语义冲突。"""
    source = Image.new("RGBA", (16, 16), (10, 20, 30, 255))
    preparer = ForegroundPreparer(
        enhancer=_ChromaEnhancer(),
        mask_adapter=_InverseMaskAdapter(),
        enable_onnx_matting=True,
    )
    try:
        prepared = preparer.prepare(source, options=_options())
        try:
            assert prepared.processing == "local_matte"
            assert prepared.image.getpixel((0, 0))[3] == 255
            assert prepared.image.getpixel((8, 8))[3] == 0
        finally:
            prepared.image.close()
            assert prepared.enhancer_image is not None
            prepared.enhancer_image.close()
    finally:
        source.close()


def test_validated_chroma_preserves_subject_when_onnx_misclassifies_its_center() -> None:
    """键色已验证时，ONNX 的局部漏检不能再把非键色主体变透明。"""
    source = Image.new("RGBA", (16, 16), (10, 20, 30, 255))
    preparer = ForegroundPreparer(
        enhancer=_ChromaEnhancer(),
        mask_adapter=_ExplodingMaskAdapter(),
        enable_onnx_matting=False,
    )
    try:
        prepared = preparer.prepare(source, options=_options())
        try:
            assert prepared.processing == "chroma_matte"
            assert prepared.foreground_model_version is None
            assert prepared.image.getpixel((0, 0))[3] == 0
            assert prepared.image.getpixel((8, 8))[3] == 255
        finally:
            prepared.image.close()
            assert prepared.enhancer_image is not None
            prepared.enhancer_image.close()
    finally:
        source.close()


def test_disabled_onnx_requires_dynamic_chroma_hint_or_explicit_fallback() -> None:
    """关闭 ONNX 且增强器未提供键色协议时，不得把不透明图误当 Solid 成功。"""
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_MissingHintEnhancer(),
        mask_adapter=_ExplodingMaskAdapter(),
        enable_onnx_matting=False,
    )
    try:
        with pytest.raises(ApiError) as raised:
            preparer.prepare(source, options=_options())
    finally:
        source.close()
    assert raised.value.status_code == 422
    assert raised.value.code == "AI_BACKGROUND_SEPARATION_FAILED"


def test_enabled_onnx_requires_dynamic_chroma_hint_before_inference() -> None:
    """ONNX 开启时 Hint 缺失仍是协议错误，不得调用模型静默掩盖。"""
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_MissingHintEnhancer(),
        mask_adapter=_ExplodingMaskAdapter(),
        enable_onnx_matting=True,
    )
    try:
        with pytest.raises(ApiError) as raised:
            preparer.prepare(source, options=_options())
    finally:
        source.close()
    assert raised.value.status_code == 422
    assert raised.value.code == "AI_BACKGROUND_SEPARATION_FAILED"


def test_chroma_validation_failure_simplify_uses_conservative_edge_mask() -> None:
    """完整校验失败时边缘键色透明化，内部孤立键色仍保持不透明且不调用 ONNX。"""
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_ChromaLowCoverageEnhancer(),
        mask_adapter=_ExplodingMaskAdapter(),
        enable_onnx_matting=False,
    )
    try:
        prepared = preparer.prepare(
            source,
            options=_options(),
            fallback_mode=ForegroundFallbackMode.SIMPLIFY,
        )
        try:
            assert prepared.processing == "fallback_simplify"
            assert prepared.applied_background_mode is BackgroundMode.SIMPLIFY
            assert prepared.degraded is True
            assert prepared.diagnostics is not None
            assert prepared.diagnostics["fallback_mask"] == "conservative-edge-key"
            assert prepared.diagnostics["validation_failures"] == [
                "border_coverage_below_minimum",
                "edge_count_below_minimum",
            ]
            assert prepared.diagnostics["min_border_coverage"] == pytest.approx(0.7)
            assert prepared.diagnostics["min_edge_count"] == 3
            assert prepared.image.getpixel((0, 0))[3] == 0
            assert prepared.image.getpixel((6, 6))[3] == 255
        finally:
            prepared.image.close()
            assert prepared.enhancer_image is not None
            prepared.enhancer_image.close()
    finally:
        source.close()


def test_low_confidence_mask_is_rejected_without_authorized_fallback() -> None:
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_OpaqueEnhancer(),
        mask_adapter=_ConstantMaskAdapter(),
    )
    try:
        with pytest.raises(ApiError) as raised:
            preparer.prepare(source, options=_options())
    finally:
        source.close()
    assert raised.value.status_code == 422
    assert raised.value.code == "AI_BACKGROUND_SEPARATION_FAILED"


def test_low_confidence_mask_can_explicitly_fallback_to_simplify() -> None:
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_ChromaEnhancer(),
        mask_adapter=_ConstantMaskAdapter(),
    )
    try:
        prepared = preparer.prepare(
            source,
            options=_options(),
            fallback_mode=ForegroundFallbackMode.SIMPLIFY,
        )
        try:
            assert prepared.processing == "fallback_simplify"
            assert prepared.applied_background_mode is BackgroundMode.SIMPLIFY
            assert prepared.degraded is True
            assert prepared.degrade_reason == "foreground_low_confidence"
            assert prepared.enhancer_image is not None
            assert prepared.image.getpixel((0, 0))[3] == 0
            assert prepared.diagnostics is not None
            assert prepared.diagnostics["foreground_validation_failures"] == [
                "foreground_coverage_above_maximum",
                "background_coverage_below_minimum",
            ]
        finally:
            prepared.image.close()
            assert prepared.enhancer_image is not None
            prepared.enhancer_image.close()
    finally:
        source.close()


def test_system_failure_never_falls_back_to_simplify() -> None:
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_OpaqueEnhancer(),
        mask_adapter=_UnavailableMaskAdapter(),
    )
    try:
        with pytest.raises(ApiError) as raised:
            preparer.prepare(
                source,
                options=_options(),
                fallback_mode=ForegroundFallbackMode.SIMPLIFY,
            )
    finally:
        source.close()
    assert raised.value.status_code == 503
    assert raised.value.code == "FOREGROUND_MASK_UNAVAILABLE"


def test_keep_and_simplify_do_not_call_mask_adapter() -> None:
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_OpaqueEnhancer(),
        mask_adapter=_UnavailableMaskAdapter(),
    )
    try:
        for mode in (BackgroundMode.KEEP, BackgroundMode.SIMPLIFY):
            prepared = preparer.prepare(source, options=_options(mode))
            try:
                assert prepared.processing == "none"
                assert prepared.applied_background_mode is mode
                assert prepared.enhancer_image is None
            finally:
                prepared.image.close()
    finally:
        source.close()
