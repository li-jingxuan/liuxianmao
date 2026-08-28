"""Solid 模式 Alpha 深模块：键色拥有主体语义，ONNX 只负责边缘补充。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageFilter

from pindou.imaging.chroma_key import ChromaPolicy, validate_chroma_mask
from pindou.services.enhancer import BackgroundHint


@dataclass(frozen=True, slots=True)
class SolidAlphaPolicy:
    """集中管理 Solid 融合阈值，避免调用端逐项改变质量语义。"""

    version: str = "solid-alpha-v1"
    min_onnx_subject_recall: float = 0.95
    min_onnx_chroma_iou: float = 0.80
    max_onnx_false_positive_background: float = 0.005
    max_onnx_core_transparent_coverage: float = 0.01
    core_alpha_threshold: int = 250
    background_alpha_threshold: int = 5


@dataclass(frozen=True, slots=True)
class SolidAlphaResult:
    mask: Image.Image
    confidence: float
    strategy: Literal["chroma_protected", "chroma_protected_onnx_edge"]
    metrics: dict[str, float | int | str | bool]


@dataclass(frozen=True, slots=True)
class SolidAlphaFailure:
    reasons: tuple[str, ...]
    metrics: dict[str, float | int | str | bool]


@dataclass(frozen=True, slots=True)
class SolidAlphaOutcome:
    result: SolidAlphaResult | None
    failure: SolidAlphaFailure | None


def compose_solid_alpha(
    image: Image.Image,
    hint: BackgroundHint,
    onnx_mask: Image.Image | None,
    *,
    policy: SolidAlphaPolicy | None = None,
) -> SolidAlphaOutcome:
    """验证键色并合成 Alpha；ONNX 只能在有限边缘带内取最大值。"""
    resolved = policy or SolidAlphaPolicy()
    chroma = validate_chroma_mask(image, hint, policy=ChromaPolicy())
    if chroma.result is None:
        failure = chroma.failure
        return SolidAlphaOutcome(
            result=None,
            failure=SolidAlphaFailure(
                reasons=failure.reasons if failure else ("chroma_validation_failed",),
                metrics=dict(failure.metrics) if failure else {},
            ),
        )
    chroma_result = chroma.result
    try:
        chroma_arr = np.asarray(chroma_result.mask, dtype=np.uint8).copy()
    finally:
        chroma_result.mask.close()

    # 小半径腐蚀定义主体核心，确保普通不透明主体内部始终为 255。
    foreground = chroma_arr >= 224
    radius = max(1, min(4, round(min(image.size) / 256)))
    core_image = Image.fromarray((foreground * 255).astype(np.uint8), mode="L")
    try:
        core = np.asarray(core_image.filter(ImageFilter.MinFilter(radius * 2 + 1)), dtype=np.uint8) >= 128
    finally:
        core_image.close()
    background = chroma_arr <= 32
    final = chroma_arr.copy()
    final[core] = 255
    final[background] = 0
    metrics: dict[str, float | int | str | bool] = dict(chroma_result.metrics)
    metrics.update({"solid_alpha_policy_version": resolved.version, "onnx_edge_accepted": False})

    if onnx_mask is not None:
        normalized = onnx_mask.convert("L")
        try:
            if normalized.size != image.size:
                resized = normalized.resize(image.size, Image.Resampling.BILINEAR)
                normalized.close()
                normalized = resized
            onnx = np.asarray(normalized, dtype=np.uint8).copy()
        finally:
            normalized.close()
        subject = ~background
        onnx_subject = onnx >= 128
        subject_area = max(1, int(np.count_nonzero(subject)))
        recall = float(np.count_nonzero(subject & onnx_subject)) / subject_area
        union = np.count_nonzero(subject | onnx_subject)
        iou = float(np.count_nonzero(subject & onnx_subject)) / max(1, int(union))
        false_bg = float(np.count_nonzero(background & onnx_subject)) / max(1, int(np.count_nonzero(background)))
        core_transparent = float(np.count_nonzero(core & (onnx < 128))) / max(1, int(np.count_nonzero(core)))
        metrics.update({"onnx_subject_recall": recall, "onnx_chroma_iou": iou,
                        "onnx_false_positive_background": false_bg,
                        "onnx_core_transparent_coverage": core_transparent})
        accepted = (recall >= resolved.min_onnx_subject_recall and iou >= resolved.min_onnx_chroma_iou
                    and false_bg <= resolved.max_onnx_false_positive_background
                    and core_transparent <= resolved.max_onnx_core_transparent_coverage)
        if accepted:
            # 仅边缘带允许 ONNX 补充，核心和明确背景保持键色决定的值。
            edge = ~(core | background)
            final[edge] = np.maximum(final[edge], onnx[edge])
            metrics["onnx_edge_accepted"] = True

    core_bad = float(np.count_nonzero(core & (final < resolved.core_alpha_threshold))) / max(1, int(np.count_nonzero(core)))
    bg_bad = float(np.count_nonzero(background & (final > resolved.background_alpha_threshold))) / max(1, int(np.count_nonzero(background)))
    metrics.update({"core_transparent_coverage": core_bad, "background_residual_coverage": bg_bad})
    if core_bad > 0.001 or bg_bad > 0.005 or final.shape != (image.height, image.width):
        return SolidAlphaOutcome(None, SolidAlphaFailure(("solid_alpha_invariant_failed",), metrics))
    strategy: Literal["chroma_protected", "chroma_protected_onnx_edge"] = (
        "chroma_protected_onnx_edge" if metrics["onnx_edge_accepted"] else "chroma_protected"
    )
    return SolidAlphaOutcome(SolidAlphaResult(Image.fromarray(final, mode="L"), chroma_result.confidence, strategy, metrics), None)
