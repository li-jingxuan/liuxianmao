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
    edge_weight: float
    max_observation_weight: float
    merge_max_delta_e00: float
    merge_max_mean_error_increase: float
    cleanup_max_delta_e00: float
    cleanup_max_edge_strength: float


CONSTRAINED_QUANTIZATION_POLICY = ConstrainedQuantizationPolicy(
    version="bead-grid-constrained-v3",
    alpha_occupied_threshold=128,
    max_color_observations=512,
    min_relative_gain=0.005,
    swap_min_relative_gain=0.0005,
    max_accepted_swaps=2,
    edge_weight=1.0,
    max_observation_weight=3.0,
    merge_max_delta_e00=6.0,
    merge_max_mean_error_increase=3.0,
    cleanup_max_delta_e00=8.0,
    cleanup_max_edge_strength=0.20,
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
    merged_color_count: int
    cleaned_cell_count: int
    distance_matrix_ms: float
    palette_selection_ms: float
    total_ms: float
    estimated_distance_matrix_bytes: int


@dataclass(frozen=True, slots=True)
class QuantizedGrid:
    """与渲染方式无关的拼豆网格结果。

    `palette` 只包含前景实际使用到的 MARD 颜色；`rows[y][x]` 存放对应索引，
    None 表示透明/背景空格。使用 tuple 保证领域结果构造后不可被 HTTP 层意外修改。
    """

    width: int
    height: int
    palette: tuple[MardColor, ...]
    rows: tuple[tuple[int | None, ...], ...]
    algorithm_version: str
    effective_max_colors: int
    bead_count: int
    color_count: int
    # 耗时指标天然随运行环境波动，不参与领域结果的确定性相等比较。
    metrics: QuantizationMetrics = field(compare=False)


@dataclass(frozen=True, slots=True)
class _ColorObservations:
    """量化模块内部的源色聚合结果。"""

    rgbs: tuple[tuple[int, int, int], ...]
    weights: tuple[float, ...]
    index_by_visible_pixel: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class _PaletteSelection:
    colors: tuple[MardColor, ...]
    assignment_by_observation: tuple[int, ...]
    delta_e_by_observation: tuple[float, ...]
    greedy_round_count: int
    accepted_swap_count: int
    merged_color_count: int
    distance_matrix_ms: float
    selection_ms: float


def _build_color_observations(
    visible_rgb: list[tuple[int, int, int]],
    visible_weights: list[float],
) -> _ColorObservations:
    """自适应降低 RGB 精度，并聚合面积与受限边缘权重。

    代表 RGB 同样按视觉权重求平均，防止一个颜色桶内的关键轮廓色被大量低梯度
    像素重新拉回普通面积平均。边缘权重已经在调用方裁剪，不会无限放大小区域。
    """
    if len(visible_rgb) != len(visible_weights):
        raise ValueError("可见像素与权重数量必须一致")
    shift = 0
    while True:
        buckets: dict[tuple[int, int, int], list[float]] = {}
        keys: list[tuple[int, int, int]] = []
        for (red, green, blue), visual_weight in zip(
            visible_rgb,
            visible_weights,
            strict=True,
        ):
            key = (red >> shift, green >> shift, blue >> shift)
            keys.append(key)
            aggregate = buckets.setdefault(key, [0.0, 0.0, 0.0, 0.0])
            aggregate[0] += red * visual_weight
            aggregate[1] += green * visual_weight
            aggregate[2] += blue * visual_weight
            aggregate[3] += visual_weight
        if (
            len(buckets) <= CONSTRAINED_QUANTIZATION_POLICY.max_color_observations
            or shift == 7
        ):
            break
        shift += 1

    ordered_keys = tuple(sorted(buckets))
    observation_index = {key: index for index, key in enumerate(ordered_keys)}
    rgbs: list[tuple[int, int, int]] = []
    weights: list[float] = []
    for key in ordered_keys:
        red_sum, green_sum, blue_sum, total_weight = buckets[key]
        rgbs.append(
            (
                round(red_sum / total_weight),
                round(green_sum / total_weight),
                round(blue_sum / total_weight),
            )
        )
        weights.append(total_weight)
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

    # 贪心目标会为了还原大面积柔和渐变而选择多个非常接近的实体色。这里在选色后
    # 尝试删除近似候选：只有颜色本身接近，并且删除后每个加权观察的平均误差增量
    # 不超过策略预算时才接受。相比硬砍颜色上限，这能保留真正高对比的身份色。
    merged_color_count = 0
    total_observation_weight = max(1.0, sum(observations.weights))
    while len(selected) > 1:
        merge_options: list[tuple[float, tuple[str, ...], tuple[int, ...]]] = []
        for first_position in range(len(selected)):
            for second_position in range(first_position + 1, len(selected)):
                first_index = selected[first_position]
                second_index = selected[second_position]
                pair_delta_e = ciede2000(
                    candidates[first_index].lab,
                    candidates[second_index].lab,
                )
                if pair_delta_e > CONSTRAINED_QUANTIZATION_POLICY.merge_max_delta_e00:
                    continue

                # 分别尝试删除近似色中的一个，保留对当前观察集合总误差更小的方向。
                for removed_position in (first_position, second_position):
                    remaining = tuple(
                        index
                        for position, index in enumerate(selected)
                        if position != removed_position
                    )
                    error = sum(
                        weight * min(row[index] for index in remaining)
                        for row, weight in zip(distances, observations.weights, strict=True)
                    )
                    mean_error_increase = max(0.0, error - current_error) / total_observation_weight
                    if (
                        mean_error_increase
                        <= CONSTRAINED_QUANTIZATION_POLICY.merge_max_mean_error_increase
                    ):
                        merge_options.append(
                            (
                                error,
                                tuple(candidates[index].code for index in remaining),
                                remaining,
                            )
                        )
        if not merge_options:
            break
        current_error, _, selected = min(merge_options)
        merged_color_count += 1

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
        merged_color_count=merged_color_count,
        distance_matrix_ms=distance_matrix_ms,
        selection_ms=(perf_counter() - selection_started_at) * 1000,
    )


def _weighted_percentile(
    values: tuple[float, ...],
    weights: tuple[float, ...],
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


def _cleanup_isolated_low_contrast_cells(
    rows: list[list[int | None]],
    *,
    palette: list[MardColor],
    edge_strengths: tuple[float, ...],
    width: int,
    height: int,
) -> int:
    """保守替换低对比孤立单格，返回实际修改数量。

    本函数只处理“周围没有同色邻居、邻域主色占绝对多数、当前格又不是高强度
    边缘”的单格。眼睛、轮廓尖角和细肢体端点通常具有较高边缘强度，因此不会
    因面积小被直接清除。读取始终来自原始快照，避免一次扫描产生连锁扩散。
    """
    snapshot = [row.copy() for row in rows]
    replacements: list[tuple[int, int, int]] = []
    for y in range(height):
        for x in range(width):
            current = snapshot[y][x]
            if current is None:
                continue
            if (
                edge_strengths[y * width + x]
                > CONSTRAINED_QUANTIZATION_POLICY.cleanup_max_edge_strength
            ):
                continue

            neighbours = [
                snapshot[next_y][next_x]
                for next_y in range(max(0, y - 1), min(height, y + 2))
                for next_x in range(max(0, x - 1), min(width, x + 2))
                if (next_x, next_y) != (x, y) and snapshot[next_y][next_x] is not None
            ]
            if not neighbours or current in neighbours:
                continue
            counts: dict[int, int] = {}
            for neighbour in neighbours:
                assert neighbour is not None
                counts[neighbour] = counts.get(neighbour, 0) + 1
            majority, majority_count = max(counts.items(), key=lambda item: (item[1], -item[0]))
            if majority_count < 3 or majority_count / len(neighbours) < 0.75:
                continue
            if (
                ciede2000(palette[current].lab, palette[majority].lab)
                > CONSTRAINED_QUANTIZATION_POLICY.cleanup_max_delta_e00
            ):
                continue
            replacements.append((x, y, majority))

    for x, y, replacement in replacements:
        rows[y][x] = replacement
    return len(replacements)


def _compact_palette(
    rows: list[list[int | None]],
    palette: list[MardColor],
) -> tuple[tuple[MardColor, ...], tuple[tuple[int | None, ...], ...]]:
    """按网格首次出现顺序移除清理后不再使用的颜色并重写索引。"""
    compacted: list[MardColor] = []
    new_index_by_old: dict[int, int] = {}
    compacted_rows: list[tuple[int | None, ...]] = []
    for row in rows:
        compacted_row: list[int | None] = []
        for old_index in row:
            if old_index is None:
                compacted_row.append(None)
                continue
            new_index = new_index_by_old.get(old_index)
            if new_index is None:
                new_index = len(compacted)
                new_index_by_old[old_index] = new_index
                compacted.append(palette[old_index])
            compacted_row.append(new_index)
        compacted_rows.append(tuple(compacted_row))
    return tuple(compacted), tuple(compacted_rows)


def quantize_to_mard_grid(
    image: Image.Image,
    *,
    chart: MardColorChart,
    color_set_size: int,
    effective_max_colors: int,
    edge_strengths: tuple[float, ...] | None = None,
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
    if edge_strengths is None:
        edge_strengths = tuple(0.0 for _ in rgba_pixels)
    if len(edge_strengths) != len(rgba_pixels):
        raise ValueError("边缘强度数量必须与图片像素数量一致")

    # 透明像素的隐藏 RGB 值没有视觉意义，参与选色会污染调色板。可见格按边缘
    # 强度获得受限加权，让小面积轮廓拥有合理话语权，但上限阻止其支配整张图。
    visible_rgb: list[tuple[int, int, int]] = []
    visible_weights: list[float] = []
    for (red, green, blue, alpha), edge_strength in zip(
        rgba_pixels,
        edge_strengths,
        strict=True,
    ):
        if alpha < CONSTRAINED_QUANTIZATION_POLICY.alpha_occupied_threshold:
            continue
        visible_rgb.append((red, green, blue))
        visible_weights.append(
            min(
                CONSTRAINED_QUANTIZATION_POLICY.max_observation_weight,
                1.0 + CONSTRAINED_QUANTIZATION_POLICY.edge_weight * max(0.0, edge_strength),
            )
        )
    if not visible_rgb:
        # 全透明图片没有调色板；仍返回尺寸完整且全部为 -1 的网格。
        empty_rows = tuple(tuple(None for _ in range(image.width)) for _ in range(image.height))
        total_ms = (perf_counter() - total_started_at) * 1000
        return QuantizedGrid(
            width=image.width,
            height=image.height,
            palette=(),
            rows=empty_rows,
            algorithm_version=CONSTRAINED_QUANTIZATION_POLICY.version,
            effective_max_colors=0,
            bead_count=0,
            color_count=0,
            metrics=QuantizationMetrics(
                occupied_cell_count=0,
                transparent_cell_count=image.width * image.height,
                observation_count=0,
                mean_delta_e00=0.0,
                p90_delta_e00=0.0,
                greedy_round_count=0,
                accepted_swap_count=0,
                merged_color_count=0,
                cleaned_cell_count=0,
                distance_matrix_ms=0.0,
                palette_selection_ms=0.0,
                total_ms=total_ms,
                estimated_distance_matrix_bytes=0,
            ),
        )

    observations = _build_color_observations(visible_rgb, visible_weights)
    max_colors = min(effective_max_colors, len(color_set.colors), len(visible_rgb))
    selection = _select_mard_palette(
        observations,
        color_set.colors,
        max_colors,
    )

    # 输出调色板继续按网格中的首次出现顺序重建，保持前端和导出契约稳定。
    output_palette: list[MardColor] = []
    output_index_by_code: dict[str, int] = {}
    rows: list[list[int | None]] = []
    visible_index = 0
    for y in range(image.height):
        row: list[int | None] = []
        for x in range(image.width):
            # rgba_pixels 保留完整 N×N 坐标；quantized_indexes 只包含可见格，
            # visible_index 专门把两种索引空间重新对齐。
            _, _, _, alpha = rgba_pixels[y * image.width + x]
            if alpha < CONSTRAINED_QUANTIZATION_POLICY.alpha_occupied_threshold:
                # 透明格和 Solid 背景都不属于主体拼豆，背景颜色由前端独立铺设。
                row.append(None)
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
        rows.append(row)

    cleaned_cell_count = _cleanup_isolated_low_contrast_cells(
        rows,
        palette=output_palette,
        edge_strengths=edge_strengths,
        width=image.width,
        height=image.height,
    )
    compacted_palette, compacted_rows = _compact_palette(rows, output_palette)

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
        mean_delta_e00=total_weighted_error / sum(observations.weights),
        p90_delta_e00=_weighted_percentile(
            selection.delta_e_by_observation,
            observations.weights,
            0.9,
        ),
        greedy_round_count=selection.greedy_round_count,
        accepted_swap_count=selection.accepted_swap_count,
        merged_color_count=selection.merged_color_count,
        cleaned_cell_count=cleaned_cell_count,
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
            "actual_color_count": len(compacted_palette),
            "mean_delta_e00": metrics.mean_delta_e00,
            "p90_delta_e00": metrics.p90_delta_e00,
            "greedy_round_count": metrics.greedy_round_count,
            "accepted_swap_count": metrics.accepted_swap_count,
            "merged_color_count": metrics.merged_color_count,
            "cleaned_cell_count": metrics.cleaned_cell_count,
            "distance_matrix_ms": metrics.distance_matrix_ms,
            "palette_selection_ms": metrics.palette_selection_ms,
            "total_ms": metrics.total_ms,
            "estimated_distance_matrix_bytes": metrics.estimated_distance_matrix_bytes,
        },
    )
    return QuantizedGrid(
        width=image.width,
        height=image.height,
        palette=compacted_palette,
        rows=compacted_rows,
        algorithm_version=CONSTRAINED_QUANTIZATION_POLICY.version,
        effective_max_colors=max_colors,
        bead_count=len(visible_rgb),
        color_count=len(compacted_palette),
        metrics=metrics,
    )
