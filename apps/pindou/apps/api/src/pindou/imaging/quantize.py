"""把方形 RGBA 工作图量化为受用户 MARD 颜色组约束的拼豆网格。"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from time import perf_counter

from PIL import Image

from pindou.color.chart import MardColor, MardColorChart
from pindou.color.distance import ciede2000, srgb_to_lab

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ConstrainedQuantizationPolicy:
    """不可由请求拼装的版本化量化策略。"""

    version: str
    alpha_occupied_threshold: int
    max_color_observations: int
    min_relative_gain: float
    swap_min_relative_gain: float
    max_accepted_swaps: int


CONSTRAINED_QUANTIZATION_POLICY = ConstrainedQuantizationPolicy(
    version="bead-grid-constrained-v1",
    alpha_occupied_threshold=128,
    max_color_observations=512,
    min_relative_gain=0.001,
    swap_min_relative_gain=0.0005,
    max_accepted_swaps=2,
)


@dataclass(frozen=True, slots=True)
class QuantizationMetrics:
    """供结构化日志和后续效果集使用的内部指标。"""

    occupied_cell_count: int
    transparent_cell_count: int
    observation_count: int
    mean_delta_e00: float
    p90_delta_e00: float
    greedy_round_count: int
    accepted_swap_count: int
    distance_matrix_ms: float
    palette_selection_ms: float
    total_ms: float
    estimated_distance_matrix_bytes: int


@dataclass(frozen=True, slots=True)
class QuantizedGrid:
    """与渲染方式无关的拼豆网格结果。

    `palette` 只包含实际使用到的 MARD 颜色；`rows[y][x]` 存放对应索引，-1
    表示透明。使用 tuple 保证领域结果构造后不可被 HTTP 层意外修改。
    """

    width: int
    height: int
    palette: tuple[MardColor, ...]
    rows: tuple[tuple[int, ...], ...]
    algorithm_version: str
    effective_max_colors: int
    # 耗时指标天然随运行环境波动，不参与领域结果的确定性相等比较。
    metrics: QuantizationMetrics = field(compare=False)


@dataclass(frozen=True, slots=True)
class _ColorObservations:
    """量化模块内部的源色聚合结果。"""

    rgbs: tuple[tuple[int, int, int], ...]
    weights: tuple[int, ...]
    index_by_visible_pixel: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class _PaletteSelection:
    colors: tuple[MardColor, ...]
    assignment_by_observation: tuple[int, ...]
    delta_e_by_observation: tuple[float, ...]
    greedy_round_count: int
    accepted_swap_count: int
    distance_matrix_ms: float
    selection_ms: float


def _build_color_observations(
    visible_rgb: list[tuple[int, int, int]],
) -> _ColorObservations:
    """自适应降低 RGB 精度，把观察数限制在可控范围并保留面积权重。"""
    shift = 0
    while True:
        buckets: dict[tuple[int, int, int], list[int]] = {}
        keys: list[tuple[int, int, int]] = []
        for red, green, blue in visible_rgb:
            key = (red >> shift, green >> shift, blue >> shift)
            keys.append(key)
            aggregate = buckets.setdefault(key, [0, 0, 0, 0])
            aggregate[0] += red
            aggregate[1] += green
            aggregate[2] += blue
            aggregate[3] += 1
        if (
            len(buckets) <= CONSTRAINED_QUANTIZATION_POLICY.max_color_observations
            or shift == 7
        ):
            break
        shift += 1

    ordered_keys = tuple(sorted(buckets))
    observation_index = {key: index for index, key in enumerate(ordered_keys)}
    rgbs: list[tuple[int, int, int]] = []
    weights: list[int] = []
    for key in ordered_keys:
        red_sum, green_sum, blue_sum, count = buckets[key]
        rgbs.append(
            (
                (red_sum + count // 2) // count,
                (green_sum + count // 2) // count,
                (blue_sum + count // 2) // count,
            )
        )
        weights.append(count)
    return _ColorObservations(
        rgbs=tuple(rgbs),
        weights=tuple(weights),
        index_by_visible_pixel=tuple(observation_index[key] for key in keys),
    )


def _select_mard_palette(
    observations: _ColorObservations,
    allowed_colors: tuple[MardColor, ...],
    max_colors: int,
) -> _PaletteSelection:
    """直接在合法 MARD 候选中执行确定性的贪心选择和有限交换。"""
    distance_started_at = perf_counter()
    candidates = tuple(sorted(allowed_colors, key=lambda color: color.code))
    observation_labs = tuple(srgb_to_lab(rgb) for rgb in observations.rgbs)
    distances = tuple(
        tuple(ciede2000(source_lab, color.lab) for color in candidates)
        for source_lab in observation_labs
    )
    distance_matrix_ms = (perf_counter() - distance_started_at) * 1000
    selection_started_at = perf_counter()

    first_index = min(
        range(len(candidates)),
        key=lambda candidate_index: (
            sum(
                weight * row[candidate_index]
                for row, weight in zip(distances, observations.weights, strict=True)
            ),
            candidates[candidate_index].code,
        ),
    )
    selected: tuple[int, ...] = (first_index,)
    best_distances = tuple(row[first_index] for row in distances)
    current_error = sum(
        weight * distance
        for weight, distance in zip(observations.weights, best_distances, strict=True)
    )

    while len(selected) < max_colors and current_error > 0:
        selected_set = set(selected)
        next_index, next_error = min(
            (
                (
                    candidate_index,
                    sum(
                        weight * min(best_distance, row[candidate_index])
                        for row, weight, best_distance in zip(
                            distances,
                            observations.weights,
                            best_distances,
                            strict=True,
                        )
                    ),
                )
                for candidate_index in range(len(candidates))
                if candidate_index not in selected_set
            ),
            key=lambda item: (item[1], candidates[item[0]].code),
        )
        relative_gain = (current_error - next_error) / current_error
        if relative_gain < CONSTRAINED_QUANTIZATION_POLICY.min_relative_gain:
            break
        selected = (*selected, next_index)
        best_distances = tuple(
            min(best_distance, row[next_index])
            for best_distance, row in zip(best_distances, distances, strict=True)
        )
        current_error = next_error

    greedy_round_count = len(selected)
    accepted_swap_count = 0
    for _ in range(CONSTRAINED_QUANTIZATION_POLICY.max_accepted_swaps):
        selected_set = set(selected)
        best_selected = selected
        best_error = current_error
        for position in range(len(selected)):
            remaining = (*selected[:position], *selected[position + 1 :])
            base_distances = tuple(
                min(row[index] for index in remaining) if remaining else float("inf")
                for row in distances
            )
            for candidate_index in range(len(candidates)):
                if candidate_index in selected_set:
                    continue
                swapped = (*selected[:position], candidate_index, *selected[position + 1 :])
                error = sum(
                    weight * min(base_distance, row[candidate_index])
                    for row, weight, base_distance in zip(
                        distances,
                        observations.weights,
                        base_distances,
                        strict=True,
                    )
                )
                if (error, tuple(candidates[index].code for index in swapped)) < (
                    best_error,
                    tuple(candidates[index].code for index in best_selected),
                ):
                    best_selected = swapped
                    best_error = error
        improvement = 0.0 if current_error <= 0 else (current_error - best_error) / current_error
        if improvement < CONSTRAINED_QUANTIZATION_POLICY.swap_min_relative_gain:
            break
        selected = best_selected
        current_error = best_error
        accepted_swap_count += 1

    selected_colors = tuple(candidates[index] for index in selected)
    assignment_by_observation = tuple(
        min(
            range(len(selected)),
            key=lambda selected_position: (
                row[selected[selected_position]],
                selected_colors[selected_position].code,
            ),
        )
        for row in distances
    )
    delta_e_by_observation = tuple(
        row[selected[assignment]]
        for row, assignment in zip(distances, assignment_by_observation, strict=True)
    )
    return _PaletteSelection(
        colors=selected_colors,
        assignment_by_observation=assignment_by_observation,
        delta_e_by_observation=delta_e_by_observation,
        greedy_round_count=greedy_round_count,
        accepted_swap_count=accepted_swap_count,
        distance_matrix_ms=distance_matrix_ms,
        selection_ms=(perf_counter() - selection_started_at) * 1000,
    )


def _weighted_percentile(
    values: tuple[float, ...],
    weights: tuple[int, ...],
    percentile: float,
) -> float:
    """计算离散观察的确定性加权百分位数。"""
    target_weight = math.ceil(sum(weights) * percentile)
    cumulative_weight = 0
    for value, weight in sorted(zip(values, weights, strict=True)):
        cumulative_weight += weight
        if cumulative_weight >= target_weight:
            return value
    return 0.0


def quantize_to_mard_grid(
    image: Image.Image,
    *,
    chart: MardColorChart,
    color_set_size: int,
    effective_max_colors: int,
) -> QuantizedGrid:
    """把 N×N RGBA 工作图量化为受颜色组约束的 MARD 网格。

    源色先聚合成带面积权重的观察集，随后直接从用户选择的 MARD 套装中贪心选择
    最多 `effective_max_colors` 个真实色号，并通过有限交换降低总 CIEDE2000 误差。
    """
    total_started_at = perf_counter()
    color_set = chart.get_set(color_set_size)
    if color_set is None:
        raise ValueError(f"unknown MARD color set: {color_set_size}")

    # 复制为统一 RGBA 像素序列；关闭副本不会影响调用方持有的原图。
    rgba_image = image.convert("RGBA")
    try:
        rgba_pixels = list(rgba_image.get_flattened_data())
    finally:
        rgba_image.close()
    # 透明像素的隐藏 RGB 值没有视觉意义，参与选色会污染调色板。
    visible_rgb = [
        (red, green, blue)
        for red, green, blue, alpha in rgba_pixels
        if alpha >= CONSTRAINED_QUANTIZATION_POLICY.alpha_occupied_threshold
    ]
    if not visible_rgb:
        # 全透明图片没有调色板；仍返回尺寸完整且全部为 -1 的网格。
        empty_rows = tuple(tuple(-1 for _ in range(image.width)) for _ in range(image.height))
        total_ms = (perf_counter() - total_started_at) * 1000
        return QuantizedGrid(
            width=image.width,
            height=image.height,
            palette=(),
            rows=empty_rows,
            algorithm_version=CONSTRAINED_QUANTIZATION_POLICY.version,
            effective_max_colors=0,
            metrics=QuantizationMetrics(
                occupied_cell_count=0,
                transparent_cell_count=image.width * image.height,
                observation_count=0,
                mean_delta_e00=0.0,
                p90_delta_e00=0.0,
                greedy_round_count=0,
                accepted_swap_count=0,
                distance_matrix_ms=0.0,
                palette_selection_ms=0.0,
                total_ms=total_ms,
                estimated_distance_matrix_bytes=0,
            ),
        )

    observations = _build_color_observations(visible_rgb)
    max_colors = min(effective_max_colors, len(color_set.colors), len(visible_rgb))
    selection = _select_mard_palette(
        observations,
        color_set.colors,
        max_colors,
    )

    # 输出调色板继续按网格中的首次出现顺序重建，保持前端和导出契约稳定。
    output_palette: list[MardColor] = []
    output_index_by_code: dict[str, int] = {}
    rows: list[tuple[int, ...]] = []
    visible_index = 0
    for y in range(image.height):
        row: list[int] = []
        for x in range(image.width):
            # rgba_pixels 保留完整 N×N 坐标；quantized_indexes 只包含可见格，
            # visible_index 专门把两种索引空间重新对齐。
            _, _, _, alpha = rgba_pixels[y * image.width + x]
            if alpha < CONSTRAINED_QUANTIZATION_POLICY.alpha_occupied_threshold:
                row.append(-1)
                continue
            observation_index = observations.index_by_visible_pixel[visible_index]
            visible_index += 1
            mapped_color = selection.colors[selection.assignment_by_observation[observation_index]]
            output_index = output_index_by_code.get(mapped_color.code)
            if output_index is None:
                output_index = len(output_palette)
                output_index_by_code[mapped_color.code] = output_index
                output_palette.append(mapped_color)
            row.append(output_index)
        rows.append(tuple(row))

    total_ms = (perf_counter() - total_started_at) * 1000
    total_weighted_error = sum(
        weight * delta_e
        for weight, delta_e in zip(
            observations.weights,
            selection.delta_e_by_observation,
            strict=True,
        )
    )
    metrics = QuantizationMetrics(
        occupied_cell_count=len(visible_rgb),
        transparent_cell_count=image.width * image.height - len(visible_rgb),
        observation_count=len(observations.rgbs),
        mean_delta_e00=total_weighted_error / len(visible_rgb),
        p90_delta_e00=_weighted_percentile(
            selection.delta_e_by_observation,
            observations.weights,
            0.9,
        ),
        greedy_round_count=selection.greedy_round_count,
        accepted_swap_count=selection.accepted_swap_count,
        distance_matrix_ms=selection.distance_matrix_ms,
        palette_selection_ms=selection.selection_ms,
        total_ms=total_ms,
        # Python float 实际对象开销更高；这里记录紧凑 float64 矩阵的可比估算值。
        estimated_distance_matrix_bytes=(
            len(observations.rgbs) * len(color_set.colors) * 8
        ),
    )
    logger.info(
        "MARD quantization completed",
        extra={
            "algorithm_version": CONSTRAINED_QUANTIZATION_POLICY.version,
            "occupied_cell_count": metrics.occupied_cell_count,
            "transparent_cell_count": metrics.transparent_cell_count,
            "observation_count": metrics.observation_count,
            "candidate_color_count": len(color_set.colors),
            "effective_max_colors": max_colors,
            "actual_color_count": len(output_palette),
            "mean_delta_e00": metrics.mean_delta_e00,
            "p90_delta_e00": metrics.p90_delta_e00,
            "greedy_round_count": metrics.greedy_round_count,
            "accepted_swap_count": metrics.accepted_swap_count,
            "distance_matrix_ms": metrics.distance_matrix_ms,
            "palette_selection_ms": metrics.palette_selection_ms,
            "total_ms": metrics.total_ms,
            "estimated_distance_matrix_bytes": metrics.estimated_distance_matrix_bytes,
        },
    )
    return QuantizedGrid(
        width=image.width,
        height=image.height,
        palette=tuple(output_palette),
        rows=tuple(rows),
        algorithm_version=CONSTRAINED_QUANTIZATION_POLICY.version,
        effective_max_colors=max_colors,
        metrics=metrics,
    )
