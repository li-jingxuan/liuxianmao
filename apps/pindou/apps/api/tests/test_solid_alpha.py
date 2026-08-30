from __future__ import annotations

from PIL import Image

from pindou.imaging.solid_alpha import SolidAlphaPolicy, compose_solid_alpha
from pindou.services.enhancer import BackgroundHint


def _enclosed_key_hole_image() -> Image.Image:
    image = Image.new("RGBA", (32, 32), (0, 255, 0, 255))
    for x in range(6, 26):
        for y in range(6, 26):
            image.putpixel((x, y), (220, 30, 30, 255))
    for x in range(14, 18):
        for y in range(14, 18):
            image.putpixel((x, y), (0, 255, 0, 255))
    return image


def _hint() -> BackgroundHint:
    return BackgroundHint("chroma_key", (0, 255, 0), "solid-chroma-v1")


def test_enclosed_key_region_is_preserved_without_independent_evidence() -> None:
    image = _enclosed_key_hole_image()
    try:
        outcome = compose_solid_alpha(image, _hint(), None)
        assert outcome.result is not None
        try:
            assert outcome.result.mask.getpixel((15, 15)) == 255
            assert outcome.result.metrics["chroma_hole_candidates"] == 1
            assert outcome.result.metrics["chroma_hole_accepted"] == 0
            assert outcome.result.metrics["chroma_hole_rejected_counts"] == {
                "independent_evidence_unavailable": 1
            }
        finally:
            outcome.result.mask.close()
    finally:
        image.close()


def test_enclosed_key_region_is_preserved_when_onnx_supports_subject() -> None:
    image = _enclosed_key_hole_image()
    onnx = Image.new("L", image.size, 0)
    for x in range(6, 26):
        for y in range(6, 26):
            onnx.putpixel((x, y), 255)
    try:
        outcome = compose_solid_alpha(image, _hint(), onnx)
        assert outcome.result is not None
        try:
            assert outcome.result.mask.getpixel((15, 15)) == 255
            assert outcome.result.metrics["chroma_hole_accepted"] == 0
            assert outcome.result.metrics["chroma_hole_rejected_counts"] == {
                "independent_subject_evidence_present": 1
            }
        finally:
            outcome.result.mask.close()
    finally:
        image.close()
        onnx.close()


def test_enclosed_key_region_is_removed_when_onnx_supports_background() -> None:
    image = _enclosed_key_hole_image()
    onnx = Image.new("L", image.size, 0)
    for x in range(6, 26):
        for y in range(6, 26):
            onnx.putpixel((x, y), 255)
    for x in range(14, 18):
        for y in range(14, 18):
            onnx.putpixel((x, y), 0)
    try:
        outcome = compose_solid_alpha(image, _hint(), onnx)
        assert outcome.result is not None
        try:
            assert outcome.result.mask.getpixel((15, 15)) == 0
            assert outcome.result.mask.getpixel((10, 10)) == 255
            assert outcome.result.metrics["chroma_hole_accepted"] == 1
            assert outcome.result.metrics["chroma_hole_rejected_counts"] == {}
        finally:
            outcome.result.mask.close()
    finally:
        image.close()
        onnx.close()


def test_accepted_hole_uses_raw_key_alpha_on_its_boundary() -> None:
    image = Image.new("RGBA", (64, 64), (0, 255, 0, 255))
    for x in range(8, 56):
        for y in range(8, 56):
            image.putpixel((x, y), (220, 30, 30, 255))
    for x in range(20, 28):
        for y in range(20, 28):
            image.putpixel((x, y), (30, 230, 30, 255))
    for x in range(21, 27):
        for y in range(21, 27):
            image.putpixel((x, y), (0, 255, 0, 255))

    onnx = Image.new("L", image.size, 0)
    for x in range(8, 56):
        for y in range(8, 56):
            onnx.putpixel((x, y), 255)
    for x in range(20, 28):
        for y in range(20, 28):
            onnx.putpixel((x, y), 0)

    policy = SolidAlphaPolicy(
        min_hole_seed_fraction=0.5,
        max_hole_color_p90_delta_e76=16.0,
    )
    try:
        outcome = compose_solid_alpha(image, _hint(), onnx, policy=policy)
        assert outcome.result is not None
        try:
            boundary_alpha = outcome.result.mask.getpixel((20, 23))
            assert 0 < boundary_alpha < 255
            assert outcome.result.mask.getpixel((23, 23)) == 0
            assert outcome.result.mask.getpixel((15, 15)) == 255
        finally:
            outcome.result.mask.close()
    finally:
        image.close()
        onnx.close()
