"""把方形 RGBA 工作图量化为受用户 MARD 颜色组约束的拼豆网格。"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

from pindou.color.chart import MardColor, MardColorChart
from pindou.color.distance import ciede2000, srgb_to_lab

# Alpha 小于 16/255 时肉眼几乎不可见，直接视为空格可避免产生边缘杂色拼豆。
ALPHA_TRANSPARENT_THRESHOLD = 16


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


def _nearest_allowed_color(
    rgb: tuple[int, int, int],
    allowed_colors: tuple[MardColor, ...],
) -> MardColor:
    """仅从用户所选颜色组中寻找感知距离最近的 MARD 颜色。

    元组排序先比较 ΔE00，再比较色号。第二比较项是稳定的并列决胜规则，避免两个
    颜色距离相等时结果依赖 JSON 原始顺序。
    """
    source_lab = srgb_to_lab(rgb)
    return min(
        allowed_colors,
        key=lambda color: (ciede2000(source_lab, color.lab), color.code),
    )


def quantize_to_mard_grid(
    image: Image.Image,
    *,
    chart: MardColorChart,
    color_set_size: int,
    max_colors: int,
) -> QuantizedGrid:
    """把 N×N RGBA 工作图量化为受颜色组约束的 MARD 网格。

    算法分为两个阶段：

    1. Median Cut 把画面归并为不超过 `max_colors` 个图片代表色；
    2. 每个代表色只在用户选择的 MARD `sets[].colors` 白名单内匹配最近色。

    必须先建立白名单再匹配，不能先在 264 色中匹配后过滤，否则用户可能得到
    所选套装中不存在的颜色，或者得到并非组内最近色的补救结果。
    """
    color_set = chart.get_set(color_set_size)
    if color_set is None:
        raise ValueError(f"unknown MARD color set: {color_set_size}")

    # 复制为统一 RGBA 像素序列；关闭副本不会影响调用方持有的原图。
    rgba_image = image.convert("RGBA")
    try:
        rgba_pixels = list(rgba_image.get_flattened_data())
    finally:
        rgba_image.close()
    # Median Cut 只处理可见像素。透明像素的隐藏 RGB 值没有视觉意义，若参与
    # 聚类会污染调色板（透明 PNG 边缘常保留编辑软件写入的黑/白 RGB）。
    visible_rgb = [
        (red, green, blue)
        for red, green, blue, alpha in rgba_pixels
        if alpha >= ALPHA_TRANSPARENT_THRESHOLD
    ]
    if not visible_rgb:
        # 全透明图片没有调色板；仍返回尺寸完整且全部为 -1 的网格。
        empty_rows = tuple(tuple(-1 for _ in range(image.width)) for _ in range(image.height))
        return QuantizedGrid(image.width, image.height, (), empty_rows)

    # 将所有可见格排成一行只是为了调用 Pillow 的成熟量化器，不改变像素顺序。
    # 关闭抖动保证不会为了模拟渐变而引入零散、难以实际拼装的杂色豆。
    sample = Image.new("RGB", (len(visible_rgb), 1))
    sample.putdata(visible_rgb)
    quantized = sample.quantize(
        colors=max_colors,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    quantized_indexes = list(quantized.get_flattened_data())
    raw_palette = quantized.getpalette()
    if raw_palette is None:
        raise RuntimeError("Pillow did not return a quantization palette")

    # dict.fromkeys 在去重的同时保留首次出现顺序，使输出调色板稳定可复现。
    used_quantized_indexes = dict.fromkeys(quantized_indexes)
    mapped_colors: dict[int, MardColor] = {}
    for palette_index in used_quantized_indexes:
        # Pillow 调色板按 [R,G,B,R,G,B,...] 平铺，每个索引占三个连续元素。
        offset = palette_index * 3
        rgb = tuple(raw_palette[offset : offset + 3])
        if len(rgb) != 3:
            raise RuntimeError("invalid Pillow quantization palette")
        # 此处传入的 color_set.colors 就是用户颜色组白名单，组外色不参与比较。
        mapped_colors[palette_index] = _nearest_allowed_color(rgb, color_set.colors)

    # 多个代表色可能映射到同一个实体 MARD 色号。下面重建紧凑调色板并合并重复色，
    # 因此最终实际用色数只会小于或等于 max_colors。
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
            if alpha < ALPHA_TRANSPARENT_THRESHOLD:
                row.append(-1)
                continue
            quantized_index = quantized_indexes[visible_index]
            visible_index += 1
            mapped_color = mapped_colors[quantized_index]
            output_index = output_index_by_code.get(mapped_color.code)
            if output_index is None:
                output_index = len(output_palette)
                output_index_by_code[mapped_color.code] = output_index
                output_palette.append(mapped_color)
            row.append(output_index)
        rows.append(tuple(row))

    return QuantizedGrid(
        width=image.width,
        height=image.height,
        palette=tuple(output_palette),
        rows=tuple(rows),
    )
