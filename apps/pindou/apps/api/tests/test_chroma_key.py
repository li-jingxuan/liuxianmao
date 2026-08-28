from __future__ import annotations

import pytest
from PIL import Image

from pindou.imaging.chroma_key import (
    ChromaPolicy,
    analyze_non_key_components,
    apply_chroma_mask_with_despill,
    build_validated_chroma_mask,
    format_chroma_key,
    fuse_chroma_with_onnx,
    select_chroma_key,
    validate_chroma_mask,
)
from pindou.services.enhancer import BackgroundHint


def _flat_key_image(
    *,
    size: tuple[int, int] = (19, 13),
    key: tuple[int, int, int] = (0, 255, 0),
) -> Image.Image:
    image = Image.new("RGBA", size, (*key, 255))
    for x in range(4, size[0] - 4):
        for y in range(3, size[1] - 3):
            image.putpixel((x, y), (220, 30, 30, 255))
    return image


def test_select_chroma_key_is_deterministic_and_avoids_visible_colors() -> None:
    image = Image.new("RGBA", (16, 16), (255, 0, 255, 255))
    try:
        first = select_chroma_key(image)
        second = select_chroma_key(image)
    finally:
        image.close()

    assert first is not None
    assert first == second
    assert first != (255, 0, 255)


def test_chroma_mask_keeps_original_size_and_disconnected_subject_key_color() -> None:
    image = _flat_key_image()
    # 主体中心故意使用键色；由于不与画布边缘连通，它必须继续属于主体。
    image.putpixel((9, 6), (0, 255, 0, 255))
    policy = ChromaPolicy(chunk_rows=3)
    try:
        result = build_validated_chroma_mask(
            image,
            BackgroundHint("chroma_key", (0, 255, 0), policy.version),
            policy=policy,
        )
        assert result is not None
        try:
            assert result.mask.size == image.size
            assert result.mask.getpixel((0, 0)) == 0
            assert result.mask.getpixel((9, 6)) == 255
        finally:
            result.mask.close()
    finally:
        image.close()


def test_chroma_validation_estimates_uniformly_shifted_actual_key() -> None:
    image = _flat_key_image(key=(10, 240, 15))
    try:
        result = build_validated_chroma_mask(
            image,
            BackgroundHint("chroma_key", (0, 255, 0), "solid-chroma-v1"),
        )
        assert result is not None
        try:
            assert result.actual_key_rgb == (10, 240, 15)
            assert result.metrics["actual_key"] == "#0AF00F"
        finally:
            result.mask.close()
    finally:
        image.close()


def test_chroma_validation_reports_background_coverage_above_maximum() -> None:
    """完整键色验证失败时保留规则、观测值和阈值，便于解释降级。"""
    image = Image.new("RGBA", (12, 12), (0, 255, 0, 255))
    policy = ChromaPolicy(max_background_coverage=0.95)
    try:
        outcome = validate_chroma_mask(
            image,
            BackgroundHint("chroma_key", (0, 255, 0), policy.version),
            policy=policy,
        )
    finally:
        image.close()

    assert outcome.result is None
    assert outcome.failure is not None
    assert outcome.failure.reasons == ("background_coverage_above_maximum",)
    assert outcome.failure.metrics["background_coverage"] == pytest.approx(1.0)
    assert outcome.failure.metrics["max_background_coverage"] == pytest.approx(0.95)


def test_onnx_can_only_add_alpha_inside_chroma_transition() -> None:
    chroma = Image.new("L", (3, 1))
    chroma.putdata((0, 128, 255))
    onnx = Image.new("L", (3, 1))
    onnx.putdata((255, 255, 0))
    try:
        fused, hybrid, metrics = fuse_chroma_with_onnx(chroma, onnx)
        try:
            assert list(fused.get_flattened_data()) == [0, 255, 255]
            assert hybrid is True
            assert metrics["foreground_disagreement"] > 0
            assert metrics["background_disagreement"] > 0
        finally:
            fused.close()
    finally:
        chroma.close()
        onnx.close()


def test_format_chroma_key_uses_uppercase_hex() -> None:
    assert format_chroma_key((10, 240, 15)) == "#0AF00F"


def test_isolated_non_key_component_without_onnx_support_is_reported() -> None:
    chroma = Image.new("L", (10, 10), 0)
    onnx = Image.new("L", (10, 10), 0)
    for x in range(2, 7):
        for y in range(2, 7):
            chroma.putpixel((x, y), 255)
            onnx.putpixel((x, y), 255)
    for x in range(8, 10):
        for y in range(8, 10):
            chroma.putpixel((x, y), 255)
    try:
        metrics = analyze_non_key_components(chroma, onnx)
    finally:
        chroma.close()
        onnx.close()

    assert metrics["unexpected_non_key_components"] == 1
    assert metrics["unexpected_non_key_coverage"] == pytest.approx(0.04)


def test_despill_removes_key_dominance_from_soft_edge() -> None:
    image = Image.new("RGBA", (3, 1))
    image.putdata(((0, 255, 0, 255), (110, 142, 15, 255), (220, 30, 30, 255)))
    mask = Image.new("L", (3, 1))
    mask.putdata((0, 128, 255))
    try:
        output = apply_chroma_mask_with_despill(image, mask, (0, 255, 0), chunk_rows=1)
        try:
            assert output.getpixel((0, 0))[3] == 0
            red, green, _blue, alpha = output.getpixel((1, 0))
            assert alpha == 128
            assert red > green
            assert output.getpixel((2, 0)) == (220, 30, 30, 255)
        finally:
            output.close()
    finally:
        image.close()
        mask.close()
