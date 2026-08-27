from __future__ import annotations

import pytest
from PIL import Image

from pindou.core.errors import ApiError
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import ForegroundPreparer, RawForegroundMask
from pindou.schemas.conversion import BackgroundMode, ForegroundFallbackMode
from pindou.services.enhancer import EnhancementOptions, EnhancementResult


class _OpaqueEnhancer:
    name = "test-enhancer"
    model = "test-model"
    prompt_version = "test-prompt"

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del options
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


class _UnavailableMaskAdapter:
    name = "test-unavailable"
    model_version = "test-v1"
    ready = False

    def generate(self, image: Image.Image) -> RawForegroundMask:
        del image
        raise ApiError(503, "FOREGROUND_MASK_UNAVAILABLE", "unavailable")


def _options(mode: BackgroundMode = BackgroundMode.SOLID) -> EnhancementOptions:
    return EnhancementOptions(
        grid_size=52,
        color_budget_band=ColorBudgetBand.BALANCED,
        background_mode=mode,
        background_color="#FFFFFF" if mode is BackgroundMode.SOLID else None,
    )


def test_solid_always_uses_local_foreground_mask() -> None:
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
            assert prepared.image.getpixel((0, 0))[3] == 0
            assert prepared.image.getpixel((6, 6))[3] == 255
        finally:
            prepared.image.close()
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
        enhancer=_OpaqueEnhancer(),
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
            assert prepared.image.getpixel((0, 0))[3] == 255
        finally:
            prepared.image.close()
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
            finally:
                prepared.image.close()
    finally:
        source.close()
