from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import ForegroundPreparer
from pindou.imaging.foreground_mask_onnx import OnnxForegroundMaskAdapter
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import EnhancementOptions, PassThroughEnhancer

onnxruntime = pytest.importorskip("onnxruntime")
pytest.importorskip("numpy")

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
MODEL_ROOT = API_ROOT / "models" / "foreground"


def _adapter() -> OnnxForegroundMaskAdapter:
    return OnnxForegroundMaskAdapter(
        model_path=MODEL_ROOT / "u2netp.onnx",
        metadata_path=MODEL_ROOT / "model.json",
        max_concurrency=1,
        queue_timeout_seconds=1,
        intra_op_threads=2,
        allow_spinning=False,
    )


def test_u2netp_generates_non_constant_mask_for_regression_image() -> None:
    adapter = _adapter()
    with Image.open(REPO_ROOT / "docs" / "20260827-170938.jpeg") as source:
        source_size = source.size
        raw = adapter.generate(source)
    try:
        assert raw.mask.size == source_size
        minimum, maximum = raw.mask.getextrema()
        assert minimum < 32
        assert maximum > 224
        assert raw.model_name == "u2netp"
        assert raw.model_version == "rembg-v0.0.0-u2netp"
    finally:
        raw.mask.close()


def test_regression_image_passes_complete_solid_preparation() -> None:
    adapter = _adapter()
    preparer = ForegroundPreparer(
        enhancer=PassThroughEnhancer(),
        mask_adapter=adapter,
    )
    with Image.open(REPO_ROOT / "docs" / "20260827-170938.jpeg") as opened:
        source = opened.convert("RGBA")
    try:
        prepared = preparer.prepare(
            source,
            options=EnhancementOptions(
                grid_size=78,
                color_budget_band=ColorBudgetBand.BALANCED,
                background_mode=BackgroundMode.SOLID,
                conversion_style=ConversionStyle.ORIGINAL,
                background_color="#FFFFFF",
            ),
        )
        try:
            assert prepared.processing == "local_matte"
            assert prepared.degraded is False
            assert prepared.image.size == source.size
        finally:
            prepared.image.close()
    finally:
        source.close()
