"""Solid 模式的动态键色选择、验证、原尺寸蒙版与保守融合。"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
from PIL import Image

from pindou.color.distance import ciede2000, srgb_to_lab
from pindou.services.enhancer import BackgroundHint

CHROMA_KEY_CANDIDATES: tuple[tuple[int, int, int], ...] = (
    (0, 255, 0),
    (255, 0, 255),
    (0, 255, 255),
    (0, 76, 255),
    (255, 59, 0),
    (122, 0, 255),
)


@dataclass(frozen=True, slots=True)
class ChromaPolicy:
    """版本化键色策略；请求端不能覆盖单项阈值。"""

    version: str = "solid-chroma-v1"
    candidate_max_edge: int = 256
    candidate_max_colors: int = 64
    candidate_min_delta_e00: float = 18.0
    diagnostic_max_edge: int = 512
    border_ratio: float = 0.02
    min_border_coverage: float = 0.70
    min_edge_count: int = 3
    min_background_coverage: float = 0.01
    max_background_coverage: float = 0.95
    max_transition_coverage: float = 0.20
    max_requested_key_delta_e76: float = 40.0
    strict_delta_e76: float = 14.0
    background_delta_e76: float = 8.0
    foreground_delta_e76: float = 28.0
    chunk_rows: int = 256


@dataclass(frozen=True, slots=True)
class ChromaMaskResult:
    """经过图像级校验、可用于前景准备的原尺寸键色软蒙版。"""

    mask: Image.Image
    confidence: float
    actual_key_rgb: tuple[int, int, int]
    metrics: dict[str, float | int | str]
    policy_version: str


@dataclass(frozen=True, slots=True)
class ChromaValidationFailure:
    """完整键色验证的失败诊断；不代表保守降级蒙版不可用。"""

    reasons: tuple[str, ...]
    metrics: dict[str, float | int | str]


@dataclass(frozen=True, slots=True)
class ChromaValidationOutcome:
    """同时保留成功蒙版或失败证据，避免 `None` 丢失降级原因。"""

    result: ChromaMaskResult | None
    failure: ChromaValidationFailure | None


def _weighted_percentile(values: list[tuple[float, float]], percentile: float) -> float:
    """计算确定性的加权分位数，避免单个噪点否决候选键色。"""
    ordered = sorted(values, key=lambda item: item[0])
    target = sum(weight for _value, weight in ordered) * percentile
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= target:
            return value
    return ordered[-1][0]


def _representative_colors(
    image: Image.Image,
    *,
    max_edge: int,
    max_colors: int,
) -> tuple[tuple[tuple[int, int, int], float], ...]:
    """缩小并聚合可见像素，返回带面积权重的有限代表色。"""
    prepared = image.convert("RGBA")
    try:
        prepared.thumbnail((max_edge, max_edge), Image.Resampling.BOX)
        pixels = np.asarray(prepared, dtype=np.uint8).copy()
    finally:
        prepared.close()
    visible = pixels[pixels[..., 3] >= 128, :3]
    if visible.size == 0:
        return ()

    shift = 0
    while True:
        keys = visible >> shift
        packed = (
            keys[:, 0].astype(np.uint32) << 16
            | keys[:, 1].astype(np.uint32) << 8
            | keys[:, 2].astype(np.uint32)
        )
        unique, inverse, counts = np.unique(packed, return_inverse=True, return_counts=True)
        if len(unique) <= max_colors or shift == 7:
            break
        shift += 1

    total = float(len(visible))
    representatives: list[tuple[tuple[int, int, int], float]] = []
    for index, count in enumerate(counts):
        members = visible[inverse == index]
        mean = members.astype(np.float64).mean(axis=0)
        representatives.append(
            ((int(round(mean[0])), int(round(mean[1])), int(round(mean[2]))), count / total)
        )
    return tuple(representatives)


def select_chroma_key(
    image: Image.Image,
    *,
    policy: ChromaPolicy | None = None,
) -> tuple[int, int, int] | None:
    """选择与输入主要颜色低分位距离最大的内部键色。"""
    resolved = policy or ChromaPolicy()
    representatives = _representative_colors(
        image,
        max_edge=resolved.candidate_max_edge,
        max_colors=resolved.candidate_max_colors,
    )
    if not representatives:
        return None

    ranked: list[tuple[float, int, tuple[int, int, int]]] = []
    for candidate_index, candidate in enumerate(CHROMA_KEY_CANDIDATES):
        candidate_lab = srgb_to_lab(candidate)
        distances = [
            (ciede2000(candidate_lab, srgb_to_lab(rgb)), weight) for rgb, weight in representatives
        ]
        score = _weighted_percentile(distances, 0.05)
        ranked.append((score, -candidate_index, candidate))
    score, _order, selected = max(ranked)
    return selected if score >= resolved.candidate_min_delta_e00 else None


def format_chroma_key(rgb: tuple[int, int, int]) -> str:
    """把内部 RGB 键色格式化为稳定的大写 HEX。"""
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def _rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """向量化把 uint8/float RGB 转成 D65 CIELAB，供分块色差计算。"""
    srgb = rgb.astype(np.float32) / 255.0
    linear = np.where(
        srgb <= 0.04045,
        srgb / 12.92,
        ((srgb + 0.055) / 1.055) ** 2.4,
    )
    xyz = (
        linear
        @ np.asarray(
            (
                (0.4124564, 0.3575761, 0.1804375),
                (0.2126729, 0.7151522, 0.0721750),
                (0.0193339, 0.1191920, 0.9503041),
            ),
            dtype=np.float32,
        ).T
    )
    xyz /= np.asarray((0.95047, 1.0, 1.08883), dtype=np.float32)
    delta = 6 / 29
    transformed = np.where(
        xyz > delta**3,
        np.cbrt(xyz),
        xyz / (3 * delta**2) + 4 / 29,
    )
    return np.stack(
        (
            116 * transformed[..., 1] - 16,
            500 * (transformed[..., 0] - transformed[..., 1]),
            200 * (transformed[..., 1] - transformed[..., 2]),
        ),
        axis=-1,
    )


def delta_e76(rgb: np.ndarray, reference_rgb: tuple[int, int, int]) -> np.ndarray:
    reference = _rgb_to_lab(np.asarray(reference_rgb, dtype=np.float32).reshape(1, 1, 3))[0, 0]
    lab = _rgb_to_lab(rgb)
    return np.sqrt(np.sum((lab - reference) ** 2, axis=-1, dtype=np.float32))


def _border_samples(
    rgb: np.ndarray,
    border_width: int,
) -> tuple[np.ndarray, tuple[np.ndarray, ...]]:
    top = rgb[:border_width, :, :]
    bottom = rgb[-border_width:, :, :]
    left = rgb[:, :border_width, :]
    right = rgb[:, -border_width:, :]
    return np.concatenate(
        (top.reshape(-1, 3), bottom.reshape(-1, 3), left.reshape(-1, 3), right.reshape(-1, 3))
    ), (top, bottom, left, right)


def _estimate_actual_key(
    border_pixels: np.ndarray,
    requested: tuple[int, int, int],
) -> tuple[int, int, int] | None:
    """从边缘主颜色簇估计实际键色，兼容上游整体均匀偏色。"""
    if border_pixels.size == 0:
        return None
    quantized = border_pixels >> 3
    packed = (
        quantized[:, 0].astype(np.uint32) << 16
        | quantized[:, 1].astype(np.uint32) << 8
        | quantized[:, 2].astype(np.uint32)
    )
    unique, inverse, counts = np.unique(packed, return_inverse=True, return_counts=True)
    minimum_cluster = max(2, round(len(border_pixels) * 0.02))
    requested_lab = _rgb_to_lab(np.asarray(requested, dtype=np.float32).reshape(1, 1, 3))[0, 0]
    candidates: list[tuple[float, int, int, tuple[int, int, int]]] = []
    for index, count in enumerate(counts):
        if count < minimum_cluster:
            continue
        members = border_pixels[inverse == index]
        median = tuple(int(value) for value in np.median(members, axis=0))
        actual_lab = _rgb_to_lab(np.asarray(median, dtype=np.float32).reshape(1, 1, 3))[0, 0]
        distance = float(np.linalg.norm(actual_lab - requested_lab))
        candidates.append((distance, -int(count), int(unique[index]), median))
    return min(candidates)[3] if candidates else None


def mark_edge_connected(candidate: np.ndarray) -> np.ndarray:
    """只保留与四边连通的键色候选，避免删除主体内部同色区域。"""
    height, width = candidate.shape
    connected = np.zeros_like(candidate, dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        if candidate[0, x]:
            queue.append((x, 0))
        if height > 1 and candidate[height - 1, x]:
            queue.append((x, height - 1))
    for y in range(1, height - 1):
        if candidate[y, 0]:
            queue.append((0, y))
        if width > 1 and candidate[y, width - 1]:
            queue.append((width - 1, y))

    # 扫描线 flood fill 只把连续横段起点放入队列，不为每个像素创建坐标 tuple。
    while queue:
        seed_x, y = queue.popleft()
        if connected[y, seed_x] or not candidate[y, seed_x]:
            continue
        left = seed_x
        while left > 0 and candidate[y, left - 1] and not connected[y, left - 1]:
            left -= 1
        right = seed_x
        while right + 1 < width and candidate[y, right + 1] and not connected[y, right + 1]:
            right += 1
        connected[y, left : right + 1] = True
        for next_y in (y - 1, y + 1):
            if not 0 <= next_y < height:
                continue
            x = left
            while x <= right:
                if candidate[next_y, x] and not connected[next_y, x]:
                    queue.append((x, next_y))
                    x += 1
                    while x <= right and candidate[next_y, x] and not connected[next_y, x]:
                        x += 1
                else:
                    x += 1
    return connected


def validate_chroma_mask(
    image: Image.Image,
    hint: BackgroundHint,
    *,
    policy: ChromaPolicy | None = None,
) -> ChromaValidationOutcome:
    """验证 Seedream 键色遵循度，并保留触发拒绝的规则与阈值。"""
    resolved = policy or ChromaPolicy()
    if hint.kind != "chroma_key" or hint.policy_version != resolved.version:
        # Hint 协议错误由编排层继续映射为 422，不伪装成质量降级。
        return ChromaValidationOutcome(result=None, failure=None)

    diagnostic = image.convert("RGB")
    try:
        diagnostic.thumbnail(
            (resolved.diagnostic_max_edge, resolved.diagnostic_max_edge),
            Image.Resampling.BOX,
        )
        diagnostic_rgb = np.asarray(diagnostic, dtype=np.uint8).copy()
    finally:
        diagnostic.close()
    border_width = max(2, round(min(diagnostic_rgb.shape[:2]) * resolved.border_ratio))
    border_pixels, diagnostic_edges = _border_samples(diagnostic_rgb, border_width)
    actual_key = _estimate_actual_key(border_pixels, hint.requested_color)
    if actual_key is None:
        return ChromaValidationOutcome(
            result=None,
            failure=ChromaValidationFailure(
                reasons=("actual_key_not_found",),
                metrics={
                    "chroma_policy_version": resolved.version,
                    "requested_key": format_chroma_key(hint.requested_color),
                },
            ),
        )

    requested_delta = float(
        np.linalg.norm(
            _rgb_to_lab(np.asarray(actual_key, dtype=np.float32).reshape(1, 1, 3))[0, 0]
            - _rgb_to_lab(np.asarray(hint.requested_color, dtype=np.float32).reshape(1, 1, 3))[0, 0]
        )
    )
    # 请求色仅用于诊断；只要实际背景满足边缘覆盖与连通性约束，允许 Seedream
    # 发生较大色漂移，避免把可分离的真实背景误判为失败。

    border_distances = delta_e76(border_pixels.reshape(1, -1, 3), actual_key).reshape(-1)
    border_coverage = float(np.mean(border_distances <= resolved.strict_delta_e76))
    edge_count = sum(
        float(np.mean(delta_e76(edge, actual_key) <= resolved.strict_delta_e76))
        >= resolved.min_border_coverage
        for edge in diagnostic_edges
    )
    border_failures: list[str] = []
    if border_coverage < resolved.min_border_coverage:
        border_failures.append("border_coverage_below_minimum")
    if edge_count < resolved.min_edge_count:
        border_failures.append("edge_count_below_minimum")
    if border_failures:
        return ChromaValidationOutcome(
            result=None,
            failure=ChromaValidationFailure(
                reasons=tuple(border_failures),
                metrics={
                    "chroma_policy_version": resolved.version,
                    "requested_key": format_chroma_key(hint.requested_color),
                    "actual_key": format_chroma_key(actual_key),
                    "requested_key_delta_e76": requested_delta,
                    "actual_key_drift_accepted": requested_delta
                    > resolved.max_requested_key_delta_e76,
                    "border_coverage": border_coverage,
                    "min_border_coverage": resolved.min_border_coverage,
                    "edge_count": edge_count,
                    "min_edge_count": resolved.min_edge_count,
                },
            ),
        )

    rgb_image = image.convert("RGB")
    try:
        width, height = rgb_image.size
        candidate = np.zeros((height, width), dtype=bool)
        for top in range(0, height, resolved.chunk_rows):
            bottom = min(height, top + resolved.chunk_rows)
            strip_image = rgb_image.crop((0, top, width, bottom))
            try:
                strip = np.asarray(strip_image, dtype=np.uint8).copy()
            finally:
                strip_image.close()
            candidate[top:bottom] = delta_e76(strip, actual_key) <= resolved.foreground_delta_e76
        connected = mark_edge_connected(candidate)
        background_coverage = float(np.mean(connected))
        if background_coverage < resolved.min_background_coverage:
            return ChromaValidationOutcome(
                result=None,
                failure=ChromaValidationFailure(
                    reasons=("background_coverage_below_minimum",),
                    metrics={
                        "chroma_policy_version": resolved.version,
                        "requested_key": format_chroma_key(hint.requested_color),
                        "actual_key": format_chroma_key(actual_key),
                        "requested_key_delta_e76": requested_delta,
                        "actual_key_drift_accepted": requested_delta
                        > resolved.max_requested_key_delta_e76,
                        "border_coverage": border_coverage,
                        "min_border_coverage": resolved.min_border_coverage,
                        "edge_count": edge_count,
                        "min_edge_count": resolved.min_edge_count,
                        "background_coverage": background_coverage,
                        "min_background_coverage": resolved.min_background_coverage,
                        "max_background_coverage": resolved.max_background_coverage,
                    },
                ),
            )
        if background_coverage > resolved.max_background_coverage:
            return ChromaValidationOutcome(
                result=None,
                failure=ChromaValidationFailure(
                    reasons=("background_coverage_above_maximum",),
                    metrics={
                        "chroma_policy_version": resolved.version,
                        "requested_key": format_chroma_key(hint.requested_color),
                        "actual_key": format_chroma_key(actual_key),
                        "requested_key_delta_e76": requested_delta,
                        "actual_key_drift_accepted": requested_delta
                        > resolved.max_requested_key_delta_e76,
                        "border_coverage": border_coverage,
                        "min_border_coverage": resolved.min_border_coverage,
                        "edge_count": edge_count,
                        "min_edge_count": resolved.min_edge_count,
                        "background_coverage": background_coverage,
                        "min_background_coverage": resolved.min_background_coverage,
                        "max_background_coverage": resolved.max_background_coverage,
                    },
                ),
            )

        alpha = np.full((height, width), 255, dtype=np.uint8)
        transition_count = 0
        for top in range(0, height, resolved.chunk_rows):
            bottom = min(height, top + resolved.chunk_rows)
            strip_image = rgb_image.crop((0, top, width, bottom))
            try:
                strip = np.asarray(strip_image, dtype=np.uint8).copy()
            finally:
                strip_image.close()
            distances = delta_e76(strip, actual_key)
            scaled = np.clip(
                (distances - resolved.background_delta_e76)
                / (resolved.foreground_delta_e76 - resolved.background_delta_e76),
                0.0,
                1.0,
            )
            strip_alpha = np.rint(scaled * 255).astype(np.uint8)
            connected_strip = connected[top:bottom]
            output_strip = alpha[top:bottom]
            output_strip[connected_strip] = strip_alpha[connected_strip]
            transition_count += int(
                np.count_nonzero(connected_strip & (strip_alpha > 0) & (strip_alpha < 255))
            )
        transition_coverage = transition_count / max(1, width * height)
        if transition_coverage > resolved.max_transition_coverage:
            return ChromaValidationOutcome(
                result=None,
                failure=ChromaValidationFailure(
                    reasons=("transition_coverage_above_maximum",),
                    metrics={
                        "chroma_policy_version": resolved.version,
                        "requested_key": format_chroma_key(hint.requested_color),
                        "actual_key": format_chroma_key(actual_key),
                        "requested_key_delta_e76": requested_delta,
                        "actual_key_drift_accepted": requested_delta
                        > resolved.max_requested_key_delta_e76,
                        "border_coverage": border_coverage,
                        "min_border_coverage": resolved.min_border_coverage,
                        "edge_count": edge_count,
                        "min_edge_count": resolved.min_edge_count,
                        "background_coverage": background_coverage,
                        "min_background_coverage": resolved.min_background_coverage,
                        "max_background_coverage": resolved.max_background_coverage,
                        "transition_coverage": transition_coverage,
                        "max_transition_coverage": resolved.max_transition_coverage,
                    },
                ),
            )
    finally:
        rgb_image.close()

    confidence = min(
        1.0,
        border_coverage,
        edge_count / 4,
        1.0 - transition_coverage,
    )
    return ChromaValidationOutcome(
        result=ChromaMaskResult(
            mask=Image.fromarray(alpha, mode="L"),
            confidence=max(0.0, confidence),
            actual_key_rgb=actual_key,
            metrics={
                "chroma_policy_version": resolved.version,
                "requested_key": format_chroma_key(hint.requested_color),
                "actual_key": format_chroma_key(actual_key),
                "requested_key_delta_e76": requested_delta,
                "actual_key_drift_accepted": requested_delta > resolved.max_requested_key_delta_e76,
                "border_coverage": border_coverage,
                "edge_count": edge_count,
                "background_coverage": background_coverage,
                "transition_coverage": transition_coverage,
            },
            policy_version=resolved.version,
        ),
        failure=None,
    )


def build_validated_chroma_mask(
    image: Image.Image,
    hint: BackgroundHint,
    *,
    policy: ChromaPolicy | None = None,
) -> ChromaMaskResult | None:
    """兼容旧调用方：只返回蒙版，需要降级原因时使用 `validate_chroma_mask`。"""
    return validate_chroma_mask(image, hint, policy=policy).result


def build_conservative_edge_key_mask(
    image: Image.Image,
    hint: BackgroundHint,
    *,
    policy: ChromaPolicy | None = None,
) -> ChromaMaskResult | None:
    """在完整键色验证失败时，仅移除与画布边缘连通的近键色区域。

    该函数不代表 Seedream 输出通过了完整质量校验；它只提供降级路径所需的最小
    背景语义。主体内部与边缘不连通的同色区域保持不透明，避免全图近色替换误伤主体。
    """
    resolved = policy or ChromaPolicy()
    if hint.kind != "chroma_key" or hint.policy_version != resolved.version:
        return None

    diagnostic = image.convert("RGB")
    try:
        diagnostic.thumbnail(
            (resolved.diagnostic_max_edge, resolved.diagnostic_max_edge),
            Image.Resampling.BOX,
        )
        diagnostic_rgb = np.asarray(diagnostic, dtype=np.uint8).copy()
    finally:
        diagnostic.close()
    border_width = max(2, round(min(diagnostic_rgb.shape[:2]) * resolved.border_ratio))
    border_pixels, _diagnostic_edges = _border_samples(diagnostic_rgb, border_width)
    # 边缘聚类估计失败或偏离请求过远时，保守地退回请求键色；绝不猜测未知背景颜色。
    estimated_key = _estimate_actual_key(border_pixels, hint.requested_color)
    actual_key = estimated_key or hint.requested_color
    if estimated_key is not None:
        requested_delta = float(
            np.linalg.norm(
                _rgb_to_lab(np.asarray(actual_key, dtype=np.float32).reshape(1, 1, 3))[0, 0]
                - _rgb_to_lab(np.asarray(hint.requested_color, dtype=np.float32).reshape(1, 1, 3))[
                    0, 0
                ]
            )
        )
        if requested_delta > resolved.max_requested_key_delta_e76:
            actual_key = hint.requested_color
    else:
        requested_delta = 0.0

    rgb_image = image.convert("RGB")
    try:
        width, height = rgb_image.size
        candidate = np.zeros((height, width), dtype=bool)
        for top in range(0, height, resolved.chunk_rows):
            bottom = min(height, top + resolved.chunk_rows)
            strip_image = rgb_image.crop((0, top, width, bottom))
            try:
                strip = np.asarray(strip_image, dtype=np.uint8).copy()
            finally:
                strip_image.close()
            candidate[top:bottom] = delta_e76(strip, actual_key) <= resolved.foreground_delta_e76
        connected = mark_edge_connected(candidate)

        alpha = np.full((height, width), 255, dtype=np.uint8)
        transition_count = 0
        for top in range(0, height, resolved.chunk_rows):
            bottom = min(height, top + resolved.chunk_rows)
            strip_image = rgb_image.crop((0, top, width, bottom))
            try:
                strip = np.asarray(strip_image, dtype=np.uint8).copy()
            finally:
                strip_image.close()
            distances = delta_e76(strip, actual_key)
            scaled = np.clip(
                (distances - resolved.background_delta_e76)
                / (resolved.foreground_delta_e76 - resolved.background_delta_e76),
                0.0,
                1.0,
            )
            strip_alpha = np.rint(scaled * 255).astype(np.uint8)
            connected_strip = connected[top:bottom]
            output_strip = alpha[top:bottom]
            output_strip[connected_strip] = strip_alpha[connected_strip]
            transition_count += int(
                np.count_nonzero(connected_strip & (strip_alpha > 0) & (strip_alpha < 255))
            )
    finally:
        rgb_image.close()

    total = max(1, width * height)
    border_distances = delta_e76(border_pixels.reshape(1, -1, 3), actual_key).reshape(-1)
    border_coverage = float(np.mean(border_distances <= resolved.strict_delta_e76))
    background_coverage = float(np.mean(connected))
    transition_coverage = transition_count / total
    return ChromaMaskResult(
        mask=Image.fromarray(alpha, mode="L"),
        confidence=0.0,
        actual_key_rgb=actual_key,
        metrics={
            "chroma_policy_version": resolved.version,
            "fallback_mask": "conservative-edge-key",
            "requested_key": format_chroma_key(hint.requested_color),
            "actual_key": format_chroma_key(actual_key),
            "requested_key_delta_e76": requested_delta,
            "border_coverage": border_coverage,
            "background_coverage": background_coverage,
            "transition_coverage": transition_coverage,
        },
        policy_version=resolved.version,
    )


def fuse_chroma_with_onnx(
    chroma_mask: Image.Image,
    onnx_mask: Image.Image | None,
) -> tuple[Image.Image, bool, dict[str, float]]:
    """只允许 ONNX 在键色过渡带增加 Alpha，禁止其删除非键色主体。"""
    normalized_chroma = chroma_mask.convert("L")
    try:
        chroma = np.asarray(normalized_chroma, dtype=np.uint8).copy()
    finally:
        normalized_chroma.close()
    if onnx_mask is None:
        return (
            Image.fromarray(chroma.copy(), mode="L"),
            False,
            {
                "foreground_disagreement": 0.0,
                "background_disagreement": 0.0,
                "transition_expansion": 0.0,
            },
        )
    normalized_onnx = onnx_mask.convert("L")
    try:
        if normalized_onnx.size != chroma_mask.size:
            resized = normalized_onnx.resize(chroma_mask.size, Image.Resampling.LANCZOS)
            normalized_onnx.close()
            normalized_onnx = resized
        # Pillow 图像会在 finally 中关闭，这里必须复制，避免数组继续引用已释放缓冲区。
        onnx = np.asarray(normalized_onnx, dtype=np.uint8).copy()
    finally:
        normalized_onnx.close()

    transition = (chroma > 0) & (chroma < 255)
    fused = chroma.copy()
    before = fused[transition].copy()
    fused[transition] = np.maximum(fused[transition], onnx[transition])
    changed = bool(np.any(fused[transition] != before))
    total = max(1, chroma.size)
    metrics = {
        "foreground_disagreement": float(np.count_nonzero((chroma == 255) & (onnx <= 32))) / total,
        "background_disagreement": float(np.count_nonzero((chroma == 0) & (onnx >= 128))) / total,
        "transition_expansion": float(np.count_nonzero(fused > chroma)) / total,
    }
    return Image.fromarray(fused, mode="L"), changed, metrics


def analyze_non_key_components(
    chroma_mask: Image.Image,
    onnx_mask: Image.Image | None,
    *,
    max_edge: int = 256,
    min_area_fraction: float = 0.005,
    min_onnx_support: float = 0.05,
) -> dict[str, float | int]:
    """识别缺少 ONNX 支持的孤立非键色物体，但不直接删除任何区域。"""
    if onnx_mask is None:
        return {
            "unexpected_non_key_components": 0,
            "unexpected_non_key_coverage": 0.0,
        }
    chroma = chroma_mask.convert("L")
    onnx_source = onnx_mask.convert("L")
    try:
        chroma.thumbnail((max_edge, max_edge), Image.Resampling.NEAREST)
        onnx = onnx_source.resize(chroma.size, Image.Resampling.BILINEAR)
        try:
            # 连通域分析发生在图像关闭之后，因此显式持有独立布尔数组。
            foreground = (np.asarray(chroma, dtype=np.uint8) >= 128).copy()
            supported = (np.asarray(onnx, dtype=np.uint8) >= 128).copy()
        finally:
            onnx.close()
    finally:
        chroma.close()
        onnx_source.close()

    height, width = foreground.shape
    flat_foreground = foreground.reshape(-1)
    flat_supported = supported.reshape(-1)
    visited = np.zeros(flat_foreground.size, dtype=bool)
    components: list[tuple[int, int]] = []
    for seed in np.flatnonzero(flat_foreground):
        seed_index = int(seed)
        if visited[seed_index]:
            continue
        queue: deque[int] = deque((seed_index,))
        visited[seed_index] = True
        area = 0
        support = 0
        while queue:
            index = queue.popleft()
            area += 1
            support += int(flat_supported[index])
            y, x = divmod(index, width)
            for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= next_x < width and 0 <= next_y < height):
                    continue
                next_index = next_y * width + next_x
                if flat_foreground[next_index] and not visited[next_index]:
                    visited[next_index] = True
                    queue.append(next_index)
        components.append((area, support))

    if not components:
        return {
            "unexpected_non_key_components": 0,
            "unexpected_non_key_coverage": 0.0,
        }
    largest_area = max(area for area, _support in components)
    minimum_area = max(1, round(width * height * min_area_fraction))
    suspicious = [
        area
        for area, support in components
        if area != largest_area and area >= minimum_area and support / area < min_onnx_support
    ]
    return {
        "unexpected_non_key_components": len(suspicious),
        "unexpected_non_key_coverage": sum(suspicious) / max(1, width * height),
    }


def apply_chroma_mask_with_despill(
    image: Image.Image,
    mask: Image.Image,
    actual_key_rgb: tuple[int, int, int],
    *,
    chunk_rows: int = 256,
) -> Image.Image:
    """分块写入 Alpha，并只在软边界反演键色混合，减少量化后的彩色边缘。"""
    rgb = image.convert("RGB")
    normalized_mask = mask.convert("L")
    output = Image.new("RGBA", image.size, (0, 0, 0, 0))
    key = np.asarray(actual_key_rgb, dtype=np.float32).reshape(1, 1, 3)
    width, height = image.size
    try:
        for top in range(0, height, chunk_rows):
            bottom = min(height, top + chunk_rows)
            rgb_crop = rgb.crop((0, top, width, bottom))
            mask_crop = normalized_mask.crop((0, top, width, bottom))
            try:
                rgb_strip = np.asarray(rgb_crop, dtype=np.uint8).copy()
                alpha_strip = np.asarray(mask_crop, dtype=np.uint8).copy()
            finally:
                rgb_crop.close()
                mask_crop.close()
            alpha = alpha_strip.astype(np.float32) / 255.0
            transition = (alpha >= 0.125) & (alpha < 1.0)
            cleaned = rgb_strip.astype(np.float32)
            if np.any(transition):
                safe_alpha = np.maximum(alpha[..., np.newaxis], 0.125)
                estimated = (cleaned - (1.0 - safe_alpha) * key) / safe_alpha
                # 只在透明度越低、键色污染越明显的位置增强反演，主体内部保持原色。
                blend = np.clip((1.0 - alpha) * 1.25, 0.0, 1.0)[..., np.newaxis]
                cleaned = np.where(
                    transition[..., np.newaxis],
                    cleaned * (1.0 - blend) + np.clip(estimated, 0.0, 255.0) * blend,
                    cleaned,
                )
            rgba = np.concatenate(
                (np.rint(cleaned).astype(np.uint8), alpha_strip[..., np.newaxis]),
                axis=-1,
            )
            strip_image = Image.fromarray(rgba, mode="RGBA")
            try:
                output.paste(strip_image, (0, top))
            finally:
                strip_image.close()
    finally:
        rgb.close()
        normalized_mask.close()
    return output
