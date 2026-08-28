from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import ForegroundPreparer
from pindou.imaging.foreground_mask_onnx import (
    OnnxForegroundMaskAdapter,
    _normalize_prediction,
)
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import (
    BackgroundHint,
    EnhancementOptions,
    EnhancementResult,
)

onnxruntime = pytest.importorskip("onnxruntime")
np = pytest.importorskip("numpy")

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
MODEL_ROOT = API_ROOT / "models" / "foreground"


class _ChromaPassThroughEnhancer:
    """回归图已是键色测试输入；测试 Adapter 只补齐生产 Hint 契约。"""

    name = "seedream-5-lite"
    model = "test"
    prompt_version = "test-chroma"
    supported_styles = frozenset(ConversionStyle)

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        assert options.background_hint_kind == "chroma_key"
        return EnhancementResult(
            image=image.convert("RGBA"),
            background_hint=BackgroundHint(
                "chroma_key",
                (0, 255, 0),
                "solid-chroma-v1",
            ),
        )


def test_probability_output_is_not_minmax_stretched() -> None:
    """概率输出必须保持绝对置信度，不能把单图噪声重新拉伸到 0..1。"""
    prediction = np.asarray([[0.20, 0.40]], dtype=np.float32)

    normalized = _normalize_prediction(prediction, output_activation="probability")

    assert normalized.reshape(-1).tolist() == pytest.approx([0.20, 0.40])


def test_logit_output_uses_stable_sigmoid() -> None:
    """未来 Logit 模型必须显式 Sigmoid，不能沿用概率或逐图拉伸语义。"""
    prediction = np.asarray([[-100.0, 0.0, 100.0]], dtype=np.float32)

    normalized = _normalize_prediction(prediction, output_activation="logits")

    assert normalized.reshape(-1).tolist() == pytest.approx([0.0, 0.5, 1.0], abs=1e-6)


def _adapter(variant: str) -> OnnxForegroundMaskAdapter:
    return OnnxForegroundMaskAdapter(
        model_path=MODEL_ROOT / f"{variant}.onnx",
        metadata_path=MODEL_ROOT / f"{variant}.json",
        expected_model_name=variant,
        max_concurrency=1,
        queue_timeout_seconds=1,
        intra_op_threads=2,
        allow_spinning=False,
    )


@pytest.fixture(
    scope="module",
    params=[
        pytest.param(
            "u2net",
            marks=pytest.mark.skipif(
                not (MODEL_ROOT / "u2net.onnx").exists(),
                reason="先运行 download_foreground_model.py 准备完整 U²-Net",
            ),
        ),
        "u2netp",
    ],
)
def adapter(request: pytest.FixtureRequest) -> OnnxForegroundMaskAdapter:
    """两个真实模型逐一装载，验证切换后仍共享同一推理契约。"""
    return _adapter(str(request.param))


def test_selected_model_generates_non_constant_mask_for_regression_image(
    adapter: OnnxForegroundMaskAdapter,
) -> None:
    with Image.open(REPO_ROOT / "docs" / "20260827-170938.jpeg") as source:
        source_size = source.size
        raw = adapter.generate(source)
    try:
        assert raw.mask.size == source_size
        minimum, maximum = raw.mask.getextrema()
        assert minimum < 32
        assert maximum > 224
        assert raw.model_name == adapter.name
        assert raw.model_version == f"rembg-v0.0.0-{adapter.name}"
    finally:
        raw.mask.close()


def test_regression_image_passes_complete_solid_preparation(
    adapter: OnnxForegroundMaskAdapter,
) -> None:
    preparer = ForegroundPreparer(
        enhancer=_ChromaPassThroughEnhancer(),
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


def test_adapter_rejects_cross_wired_model_metadata(tmp_path: Path) -> None:
    """变体名称必须与元数据一致，禁止误把另一模型的元数据配给当前资产。"""
    model_path = tmp_path / "u2net.onnx"
    metadata_path = tmp_path / "u2net.json"
    model_path.write_bytes(b"not-reached")
    metadata_path.write_text(
        '{"name":"u2netp","sha256":"not-reached"}',
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="metadata mismatch"):
        OnnxForegroundMaskAdapter(
            model_path=model_path,
            metadata_path=metadata_path,
            expected_model_name="u2net",
            max_concurrency=1,
            queue_timeout_seconds=1,
            intra_op_threads=1,
            allow_spinning=False,
        )
