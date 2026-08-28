"""Solid 模式 Alpha 深模块：键色拥有主体语义，ONNX 只负责边缘补充。"""

from __future__ import annotations

from dataclasses import dataclass
from collections import deque
from typing import Literal

import numpy as np
from PIL import Image, ImageFilter

from pindou.imaging.chroma_key import ChromaPolicy, _delta_e76, validate_chroma_mask
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
    hole_delta_e76: float = 18.0
    min_hole_area_fraction: float = 0.0002
    max_hole_area_fraction: float = 0.15
    min_subject_boundary_ratio: float = 0.60
    min_hole_color_consistency: float = 0.90
    max_hole_color_p90_delta_e76: float = 12.0


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


def _detect_enclosed_holes(
    image: Image.Image,
    chroma_alpha: np.ndarray,
    actual_key_rgb: tuple[int, int, int],
    *,
    policy: SolidAlphaPolicy,
) -> tuple[np.ndarray, dict[str, float | int | list[str]]]:
    """识别被主体包围的近键色连通域，避免只依赖画布边缘连通性。"""
    rgb_image = image.convert("RGB")
    try:
        rgb = np.asarray(rgb_image, dtype=np.uint8).copy()
    finally:
        rgb_image.close()
    candidate = _delta_e76(rgb, actual_key_rgb) <= policy.hole_delta_e76
    height, width = candidate.shape
    visited = np.zeros_like(candidate, dtype=bool)
    holes = np.zeros_like(candidate, dtype=bool)
    total = max(1, width * height)
    min_area = max(1, round(total * policy.min_hole_area_fraction))
    max_area = max(min_area, round(total * policy.max_hole_area_fraction))
    accepted = 0
    candidates = 0
    rejected: list[str] = []
    for seed in np.flatnonzero(candidate):
        sy, sx = divmod(int(seed), width)
        if visited[sy, sx]:
            continue
        queue: deque[tuple[int, int]] = deque([(sy, sx)])
        visited[sy, sx] = True
        pixels: list[tuple[int, int]] = []
        touches_edge = False
        while queue:
            y, x = queue.popleft()
            pixels.append((y, x))
            touches_edge |= y == 0 or x == 0 or y == height - 1 or x == width - 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and candidate[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))
        if touches_edge:
            continue
        candidates += 1
        area = len(pixels)
        if area < min_area:
            rejected.append("hole_area_below_minimum")
            continue
        if area > max_area:
            rejected.append("hole_area_above_maximum")
            continue
        component = np.asarray([rgb[y, x] for y, x in pixels], dtype=np.float32)
        distances = _delta_e76(component.reshape(1, -1, 3), actual_key_rgb).reshape(-1)
        consistency = float(np.mean(distances <= policy.hole_delta_e76))
        if consistency < policy.min_hole_color_consistency or float(np.percentile(distances, 90)) > policy.max_hole_color_p90_delta_e76:
            rejected.append("hole_color_inconsistent")
            continue
        boundary = 0
        subject_boundary = 0
        for y, x in pixels:
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and not candidate[ny, nx]:
                    boundary += 1
                    subject_boundary += int(chroma_alpha[ny, nx] >= 128)
        boundary_ratio = subject_boundary / max(1, boundary)
        if boundary_ratio < policy.min_subject_boundary_ratio:
            rejected.append("hole_subject_boundary_below_minimum")
            continue
        for y, x in pixels:
            holes[y, x] = True
        accepted += 1
    return holes, {"chroma_hole_candidates": candidates, "chroma_hole_accepted": accepted,
                   "chroma_hole_coverage": float(np.count_nonzero(holes)) / total,
                   "chroma_hole_rejected_reasons": rejected}


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
    holes, hole_metrics = _detect_enclosed_holes(
        image, chroma_arr, chroma_result.actual_key_rgb, policy=resolved
    )
    background |= holes
    # 孔洞先于核心不变量生效，不能把封闭背景误计入主体核心面积。
    core &= ~holes
    final = chroma_arr.copy()
    final[core] = 255
    final[background] = 0
    metrics: dict[str, float | int | str | bool] = dict(chroma_result.metrics)
    metrics.update(hole_metrics)
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
