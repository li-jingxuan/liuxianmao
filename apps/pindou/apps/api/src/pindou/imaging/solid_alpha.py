"""Solid 模式 Alpha 深模块：键色拥有主体语义，ONNX 只负责边缘补充。"""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageFilter

from pindou.core.event_log import JSONValue
from pindou.imaging.chroma_key import (
    ChromaPolicy,
    delta_e76,
    mark_edge_connected,
    validate_chroma_mask,
)
from pindou.services.enhancer import BackgroundHint


@dataclass(frozen=True, slots=True)
class SolidAlphaPolicy:
    """集中管理 Solid 融合阈值，避免调用端逐项改变质量语义。"""

    version: str = "solid-alpha-v2"
    min_onnx_subject_recall: float = 0.95
    min_onnx_chroma_iou: float = 0.80
    max_onnx_false_positive_background: float = 0.005
    max_onnx_core_transparent_coverage: float = 0.01
    core_alpha_threshold: int = 250
    background_alpha_threshold: int = 5
    hole_seed_delta_e76: float = 10.0
    hole_growth_delta_e76: float = 18.0
    trusted_subject_min_delta_e76: float = 28.0
    min_hole_area_fraction: float = 0.0002
    max_hole_area_fraction: float = 0.15
    min_trusted_subject_boundary_ratio: float = 0.60
    min_hole_seed_fraction: float = 0.60
    max_hole_color_p90_delta_e76: float = 12.0
    max_transition_boundary_ratio: float = 0.35
    max_internal_subject_fragment_fraction: float = 0.01
    min_onnx_hole_background_support: float = 0.90
    max_onnx_hole_subject_support: float = 0.05
    max_hole_components: int = 512


@dataclass(frozen=True, slots=True)
class SolidAlphaResult:
    mask: Image.Image
    actual_key_rgb: tuple[int, int, int]
    confidence: float
    strategy: Literal["chroma_protected", "chroma_protected_onnx_edge"]
    metrics: dict[str, JSONValue]


@dataclass(frozen=True, slots=True)
class SolidAlphaFailure:
    reasons: tuple[str, ...]
    metrics: dict[str, JSONValue]


@dataclass(frozen=True, slots=True)
class SolidAlphaOutcome:
    result: SolidAlphaResult | None
    failure: SolidAlphaFailure | None


def _detect_enclosed_holes(
    rgb: np.ndarray,
    chroma_alpha: np.ndarray,
    trusted_core: np.ndarray,
    actual_key_rgb: tuple[int, int, int],
    onnx: np.ndarray | None,
    *,
    policy: SolidAlphaPolicy,
) -> tuple[np.ndarray, np.ndarray, dict[str, JSONValue]]:
    """返回已接受孔洞、原始键色 Alpha 和结构化诊断。"""
    distances = delta_e76(rgb, actual_key_rgb)
    seed_mask = distances <= policy.hole_seed_delta_e76
    growth_mask = distances <= policy.hole_growth_delta_e76
    internal_growth = growth_mask & ~mark_edge_connected(growth_mask)
    height, width = internal_growth.shape
    visited = np.zeros_like(internal_growth, dtype=bool)
    accepted_holes = np.zeros_like(growth_mask, dtype=bool)
    total = max(1, width * height)
    min_area = max(1, round(total * policy.min_hole_area_fraction))
    max_area = max(min_area, round(total * policy.max_hole_area_fraction))
    accepted = 0
    candidates = 0
    rejected: list[str] = []
    component_summaries: list[dict[str, JSONValue]] = []
    component_limit_exceeded = False

    component_lookup = np.zeros_like(internal_growth, dtype=bool)
    for flat_seed in np.flatnonzero(internal_growth):
        sy, sx = divmod(int(flat_seed), width)
        if visited[sy, sx]:
            continue
        queue: deque[tuple[int, int]] = deque([(sy, sx)])
        visited[sy, sx] = True
        pixels: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            pixels.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= ny < height
                    and 0 <= nx < width
                    and internal_growth[ny, nx]
                    and not visited[ny, nx]
                ):
                    visited[ny, nx] = True
                    queue.append((ny, nx))
        candidates += 1
        if candidates > policy.max_hole_components:
            component_limit_exceeded = True
            rejected.append("component_limit_exceeded")
            break

        area = len(pixels)
        ys = np.fromiter((y for y, _x in pixels), dtype=np.intp, count=area)
        xs = np.fromiter((x for _y, x in pixels), dtype=np.intp, count=area)
        reason: str | None = None
        if area < min_area:
            reason = "area_below_minimum"
        elif area > max_area:
            reason = "area_above_maximum"

        component_distances = distances[ys, xs]
        seed_fraction = float(np.mean(seed_mask[ys, xs]))
        color_p90 = float(np.percentile(component_distances, 90))
        if reason is None and seed_fraction < policy.min_hole_seed_fraction:
            reason = "seed_fraction_below_minimum"
        if reason is None and color_p90 > policy.max_hole_color_p90_delta_e76:
            reason = "color_inconsistent"

        boundary = 0
        trusted_boundary = 0
        transition_boundary = 0
        component_lookup[ys, xs] = True
        for y, x in pixels:
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if (ny == y and nx == x) or component_lookup[ny, nx]:
                        continue
                    boundary += 1
                    trusted_boundary += int(trusted_core[ny, nx])
                    transition_boundary += int(32 < chroma_alpha[ny, nx] < 224)
        trusted_boundary_ratio = trusted_boundary / max(1, boundary)
        transition_boundary_ratio = transition_boundary / max(1, boundary)
        if reason is None and trusted_boundary_ratio < policy.min_trusted_subject_boundary_ratio:
            reason = "trusted_subject_boundary_below_minimum"
        if reason is None and transition_boundary_ratio > policy.max_transition_boundary_ratio:
            reason = "transition_boundary_above_maximum"

        internal_subject_fraction = float(np.mean(trusted_core[ys, xs]))
        if (
            reason is None
            and internal_subject_fraction > policy.max_internal_subject_fragment_fraction
        ):
            reason = "internal_subject_fragment_above_maximum"

        background_support: float | None = None
        subject_support: float | None = None
        if reason is None and onnx is None:
            reason = "independent_evidence_unavailable"
        elif reason is None:
            background_support = float(np.mean(onnx[ys, xs] < 128))
            subject_support = float(np.mean(onnx[ys, xs] >= 224))
            if subject_support > policy.max_onnx_hole_subject_support:
                reason = "independent_subject_evidence_present"
            elif background_support < policy.min_onnx_hole_background_support:
                reason = "independent_background_support_below_minimum"

        if reason is None:
            accepted_holes[ys, xs] = True
            accepted += 1
        else:
            rejected.append(reason)

        if len(component_summaries) < 16:
            component_summaries.append(
                {
                    "area": area,
                    "coverage": area / total,
                    "seed_fraction": seed_fraction,
                    "color_p90_delta_e76": color_p90,
                    "trusted_subject_boundary_ratio": trusted_boundary_ratio,
                    "transition_boundary_ratio": transition_boundary_ratio,
                    "internal_subject_fraction": internal_subject_fraction,
                    "onnx_background_support": background_support,
                    "onnx_subject_support": subject_support,
                    "accepted": reason is None,
                    "rejection_reason": reason,
                }
            )
        component_lookup[ys, xs] = False

    chroma_policy = ChromaPolicy()
    raw_scaled = np.clip(
        (distances - chroma_policy.background_delta_e76)
        / (chroma_policy.foreground_delta_e76 - chroma_policy.background_delta_e76),
        0.0,
        1.0,
    )
    raw_key_alpha = np.rint(raw_scaled * 255).astype(np.uint8)
    return (
        accepted_holes,
        raw_key_alpha,
        {
            "chroma_hole_candidates": candidates,
            "chroma_hole_accepted": accepted,
            "chroma_hole_coverage": float(np.count_nonzero(accepted_holes)) / total,
            "chroma_hole_rejected_counts": dict(Counter(rejected)),
            "chroma_hole_component_limit_exceeded": component_limit_exceeded,
            "chroma_hole_components": component_summaries,
        },
    )


def _erode_four(mask: np.ndarray) -> np.ndarray:
    """按背景 4 邻域向内腐蚀一层。"""
    eroded = np.zeros_like(mask, dtype=bool)
    if mask.shape[0] < 3 or mask.shape[1] < 3:
        return eroded
    eroded[1:-1, 1:-1] = (
        mask[1:-1, 1:-1] & mask[:-2, 1:-1] & mask[2:, 1:-1] & mask[1:-1, :-2] & mask[1:-1, 2:]
    )
    return eroded


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

    rgb_image = image.convert("RGB")
    try:
        rgb = np.asarray(rgb_image, dtype=np.uint8).copy()
    finally:
        rgb_image.close()
    color_distances = delta_e76(rgb, chroma_result.actual_key_rgb)

    onnx: np.ndarray | None = None
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

    # 小半径腐蚀定义主体核心；可信核心还必须与实际键色保持足够距离。
    foreground = chroma_arr >= 224
    radius = max(1, min(4, round(min(image.size) / 256)))
    core_image = Image.fromarray((foreground * 255).astype(np.uint8), mode="L")
    try:
        core = (
            np.asarray(core_image.filter(ImageFilter.MinFilter(radius * 2 + 1)), dtype=np.uint8)
            >= 128
        )
    finally:
        core_image.close()
    trusted_core = core & (color_distances >= resolved.trusted_subject_min_delta_e76)
    edge_background = chroma_arr <= 32

    metrics: dict[str, JSONValue] = dict(chroma_result.metrics)
    metrics.update(
        {
            "solid_alpha_policy_version": resolved.version,
            "onnx_edge_accepted": False,
            "onnx_evidence_available": onnx is not None,
        }
    )

    onnx_accepted = False
    if onnx is not None:
        subject = ~edge_background
        onnx_subject = onnx >= 128
        subject_area = max(1, int(np.count_nonzero(subject)))
        recall = float(np.count_nonzero(subject & onnx_subject)) / subject_area
        union = np.count_nonzero(subject | onnx_subject)
        iou = float(np.count_nonzero(subject & onnx_subject)) / max(1, int(union))
        false_bg = float(np.count_nonzero(edge_background & onnx_subject)) / max(
            1, int(np.count_nonzero(edge_background))
        )
        core_transparent = float(np.count_nonzero(trusted_core & (onnx < 128))) / max(
            1, int(np.count_nonzero(trusted_core))
        )
        metrics.update(
            {
                "onnx_subject_recall": recall,
                "onnx_chroma_iou": iou,
                "onnx_false_positive_background": false_bg,
                "onnx_core_transparent_coverage": core_transparent,
            }
        )
        onnx_accepted = (
            recall >= resolved.min_onnx_subject_recall
            and iou >= resolved.min_onnx_chroma_iou
            and false_bg <= resolved.max_onnx_false_positive_background
            and core_transparent <= resolved.max_onnx_core_transparent_coverage
        )
    metrics["onnx_evidence_accepted"] = onnx_accepted

    holes, raw_key_alpha, hole_metrics = _detect_enclosed_holes(
        rgb,
        chroma_arr,
        trusted_core,
        chroma_result.actual_key_rgb,
        onnx if onnx_accepted else None,
        policy=resolved,
    )
    metrics.update(hole_metrics)

    final = chroma_arr.copy()
    final[core] = 255
    final[edge_background] = 0
    if onnx_accepted and onnx is not None:
        edge = ~(core | edge_background)
        final[edge] = np.maximum(final[edge], onnx[edge])
        metrics["onnx_edge_accepted"] = True

    # 已接受孔洞在 ONNX 边缘补充之后写入，避免模型把孔洞重新恢复成主体。
    remaining = holes.copy()
    for distance in range(radius):
        eroded = _erode_four(remaining)
        boundary = remaining & ~eroded
        distance_cap = round(255 * max(0.0, 1.0 - distance / radius))
        final[boundary] = np.minimum(raw_key_alpha[boundary], distance_cap)
        remaining = eroded
    final[remaining] = 0
    final[trusted_core] = 255

    protected_core = core & ~holes
    hard_background = edge_background | remaining
    core_bad = float(
        np.count_nonzero(protected_core & (final < resolved.core_alpha_threshold))
    ) / max(1, int(np.count_nonzero(protected_core)))
    bg_bad = float(
        np.count_nonzero(hard_background & (final > resolved.background_alpha_threshold))
    ) / max(1, int(np.count_nonzero(hard_background)))
    metrics.update({"core_transparent_coverage": core_bad, "background_residual_coverage": bg_bad})
    if core_bad > 0.001 or bg_bad > 0.005 or final.shape != (image.height, image.width):
        return SolidAlphaOutcome(
            None, SolidAlphaFailure(("solid_alpha_invariant_failed",), metrics)
        )
    strategy: Literal["chroma_protected", "chroma_protected_onnx_edge"] = (
        "chroma_protected_onnx_edge" if metrics["onnx_edge_accepted"] else "chroma_protected"
    )
    return SolidAlphaOutcome(
        SolidAlphaResult(
            Image.fromarray(final, mode="L"),
            chroma_result.actual_key_rgb,
            chroma_result.confidence,
            strategy,
            metrics,
        ),
        None,
    )
