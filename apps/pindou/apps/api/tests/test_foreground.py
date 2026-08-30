from __future__ import annotations

import pytest
from PIL import Image

from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import ForegroundPreparer, RawForegroundMask
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import EnhancementOptions, EnhancementResult, NativeAlphaHint


class _NativeAlphaEnhancer:
    name = "seedream-5-pro"
    model = "doubao-seedream-5-0-pro-260628"
    prompt_version = "test-native-alpha"
    supported_styles = frozenset(ConversionStyle)

    def __init__(self, alpha: int | str = "center", *, hint: bool = True) -> None:
        self.alpha = alpha
        self.hint = hint

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del options
        output = Image.new("RGBA", image.size, (20, 40, 60, 0))
        if self.alpha == "center":
            for x in range(2, image.width - 2):
                for y in range(2, image.height - 2):
                    output.putpixel((x, y), (200, 30, 40, 255))
        else:
            output.putalpha(int(self.alpha))
        return EnhancementResult(
            image=output,
            background_hint=NativeAlphaHint() if self.hint else None,
        )


class _ExplodingMaskAdapter:
    name = "must-not-run"
    model_version = "must-not-run"
    ready = True

    def generate(self, image: Image.Image) -> RawForegroundMask:
        del image
        raise AssertionError("原生 Alpha 主路径不应调用 ONNX")


class _ValidMaskAdapter:
    name = "test-onnx"
    model_version = "test-onnx-v1"
    ready = True

    def __init__(self) -> None:
        self.input_pixel: tuple[int, int, int, int] | None = None

    def generate(self, image: Image.Image) -> RawForegroundMask:
        self.input_pixel = image.getpixel((0, 0))
        mask = Image.new("L", image.size, 0)
        for x in range(2, image.width - 2):
            for y in range(2, image.height - 2):
                mask.putpixel((x, y), 255)
        return RawForegroundMask(mask, self.name, self.model_version)


def _options(mode: BackgroundMode = BackgroundMode.SOLID) -> EnhancementOptions:
    return EnhancementOptions(
        grid_size=52,
        color_budget_band=ColorBudgetBand.BALANCED,
        background_mode=mode,
        conversion_style=ConversionStyle.ORIGINAL,
        background_color="#FFFFFF" if mode is BackgroundMode.SOLID else None,
    )


def test_solid_accepts_valid_native_alpha_without_calling_onnx() -> None:
    source = Image.new("RGBA", (12, 12), (255, 255, 255, 255))
    preparer = ForegroundPreparer(
        enhancer=_NativeAlphaEnhancer(),
        mask_adapter=_ExplodingMaskAdapter(),
        enable_onnx_matting=True,
    )
    try:
        prepared = preparer.prepare(source, options=_options())
        try:
            assert prepared.processing == "transparent_background"
            assert prepared.applied_background_mode is BackgroundMode.SOLID
            assert prepared.enhancer_name == "seedream-5-pro"
            assert prepared.foreground_model_version is None
            assert prepared.image.getpixel((0, 0))[3] == 0
            assert prepared.image.getpixel((6, 6))[3] == 255
            assert prepared.diagnostics is None
        finally:
            prepared.image.close()
    finally:
        source.close()


@pytest.mark.parametrize("alpha", [0, 255])
def test_solid_accepts_any_alpha_shape_without_quality_scoring(alpha: int) -> None:
    source = Image.new("RGBA", (12, 12), (255, 255, 255, 255))
    preparer = ForegroundPreparer(
        enhancer=_NativeAlphaEnhancer(alpha),
        mask_adapter=_ExplodingMaskAdapter(),
    )
    try:
        prepared = preparer.prepare(source, options=_options())
        prepared.image.close()
    finally:
        source.close()
def test_solid_uses_onnx_fallback_when_native_alpha_is_missing() -> None:
    source = Image.new("RGBA", (12, 12), (255, 255, 255, 255))
    adapter = _ValidMaskAdapter()
    preparer = ForegroundPreparer(
        enhancer=_NativeAlphaEnhancer(hint=False),
        mask_adapter=adapter,
    )
    try:
        prepared = preparer.prepare(source, options=_options())
        try:
            assert prepared.processing == "local_matte"
            assert prepared.foreground_model_version == "test-onnx-v1"
            assert adapter.input_pixel == (0, 0, 0, 0)
        finally:
            prepared.image.close()
    finally:
        source.close()


def test_keep_and_simplify_preserve_enhancer_output_without_masking() -> None:
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    preparer = ForegroundPreparer(
        enhancer=_NativeAlphaEnhancer(255, hint=False),
        mask_adapter=_ExplodingMaskAdapter(),
    )
    try:
        for mode in (BackgroundMode.KEEP, BackgroundMode.SIMPLIFY):
            prepared = preparer.prepare(source, options=_options(mode))
            try:
                assert prepared.processing == "none"
                assert prepared.applied_background_mode is mode
            finally:
                prepared.image.close()
    finally:
        source.close()
