"""把增强结果规范化为可安全量化的前景 RGBA 图片。"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, replace
from statistics import median
from typing import Literal

from PIL import Image

from pindou.core.errors import ApiError
from pindou.schemas.conversion import BackgroundMode
from pindou.services.enhancer import EnhancementOptions, ImageEnhancer

logger = logging.getLogger(__name__)

# 键色必须足够饱和，才能与白色、灰色、肤色及常见自然背景拉开距离。候选数量
# 保持很小，便于 Prompt 稳定表达，也避免每次请求生成不可预测的新颜色。
_CHROMA_KEY_CANDIDATES = ("#00FF00", "#FF00FF", "#00FFFF", "#004CFF")
# AI 输出的实际键色通常会偏离 Prompt 指定值。先用较宽范围收集边缘样本，
# 再围绕实测键色计算连续遮罩，避免用单一 RGB 距离制造生硬的透明度断层。
_MAX_KEY_ESTIMATION_OPACITY = 0.35
_CHROMA_BACKGROUND_OPACITY = 0.18
_CHROMA_FOREGROUND_OPACITY = 0.55
_CHROMA_DESPILL_LIMIT = 0.75
_MIN_BORDER_KEY_COVERAGE = 0.50
_MIN_FOREGROUND_COVERAGE = 0.01
_MAX_FOREGROUND_COVERAGE = 0.95
_MIN_NATIVE_TRANSPARENT_COVERAGE = 0.05
_MIN_NATIVE_BORDER_TRANSPARENT_COVERAGE = 0.50


@dataclass(frozen=True, slots=True)
class PreparedForeground:
    """前景准备模块的稳定结果。

    `image` 的 Alpha 是后续豆数统计的唯一占用依据；`processing` 只描述已经通过
    验证的处理路径。调用方拥有返回图片，并负责在量化完成后关闭它。
    """

    image: Image.Image
    processing: Literal["none", "native_alpha", "chroma_key"]
    confidence: float


def _parse_hex_color(value: str) -> tuple[int, int, int]:
    """把模块内部生成的标准 HEX 转成 RGB，不接受宽松输入。"""
    if len(value) != 7 or not value.startswith("#"):
        raise ValueError("内部键色必须为 #RRGGBB")
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))  # type: ignore[return-value]


def _border_coordinates(width: int, height: int) -> tuple[tuple[int, int], ...]:
    """返回去重后的四边坐标，防止四个角在覆盖率中获得双倍权重。"""
    if width <= 0 or height <= 0:
        return ()
    coordinates = [(x, 0) for x in range(width)]
    if height > 1:
        coordinates.extend((x, height - 1) for x in range(width))
    coordinates.extend((0, y) for y in range(1, height - 1))
    if width > 1:
        coordinates.extend((width - 1, y) for y in range(1, height - 1))
    return tuple(coordinates)


def _choose_chroma_key(image: Image.Image) -> str:
    """选择与原图主要颜色距离最大的内部键色。

    这里只需要避免键色撞上主体的大面积颜色，因此先把原图缩小并量化为最多
    12 个主色，再计算候选键色到这些主色的最短 RGB 距离。键色本身是高饱和
    极值色，RGB 距离足以完成快速候选筛选；实际蒙版仍会经过边缘覆盖率验证。
    """
    preview = image.convert("RGB")
    try:
        preview.thumbnail((64, 64), Image.Resampling.BOX)
        quantized = preview.quantize(colors=12, method=Image.Quantize.MEDIANCUT)
        try:
            palette = quantized.getpalette() or []
            histogram = quantized.getcolors(maxcolors=12) or []
            total = max(1, sum(count for count, _ in histogram))
            dominant_colors = []
            for count, palette_index in histogram:
                # 低于 1% 的偶发像素不应否决一个本来安全的键色。
                if count / total < 0.01:
                    continue
                offset = palette_index * 3
                dominant_colors.append(tuple(palette[offset : offset + 3]))
        finally:
            quantized.close()
    finally:
        preview.close()

    if not dominant_colors:
        dominant_colors = [(127, 127, 127)]

    def candidate_score(candidate: str) -> tuple[int, str]:
        red, green, blue = _parse_hex_color(candidate)
        minimum_distance = min(
            (red - source[0]) ** 2 + (green - source[1]) ** 2 + (blue - source[2]) ** 2
            for source in dominant_colors
        )
        # HEX 作为并列决胜条件，保证相同输入始终选择相同键色。
        return minimum_distance, candidate

    return max(_CHROMA_KEY_CANDIDATES, key=candidate_score)


def _has_meaningful_native_alpha(image: Image.Image) -> tuple[bool, float]:
    """验证 Alpha 是否真能表达完整前景，而不是只检查通道是否存在。

    有效蒙版需要同时满足：存在足够透明区域、存在合理主体面积、四边至少一部分
    透明。这样可以拒绝“只有一个随机透明像素”的上游结果，同时允许主体局部接边。
    """
    rgba = image.convert("RGBA")
    try:
        pixels = list(rgba.get_flattened_data())
        total = max(1, len(pixels))
        transparent_count = sum(alpha < 16 for _, _, _, alpha in pixels)
        occupied_count = sum(alpha >= 128 for _, _, _, alpha in pixels)
        border = _border_coordinates(rgba.width, rgba.height)
        border_transparent = sum(rgba.getpixel((x, y))[3] < 16 for x, y in border)
    finally:
        rgba.close()

    transparent_coverage = transparent_count / total
    foreground_coverage = occupied_count / total
    border_coverage = border_transparent / max(1, len(border))
    valid = (
        transparent_coverage >= _MIN_NATIVE_TRANSPARENT_COVERAGE
        and _MIN_FOREGROUND_COVERAGE <= foreground_coverage <= _MAX_FOREGROUND_COVERAGE
        and border_coverage >= _MIN_NATIVE_BORDER_TRANSPARENT_COVERAGE
    )
    # 置信度取三项中最弱的一项，便于日志和后续效果集发现临界样例。
    confidence = min(
        1.0,
        transparent_coverage / _MIN_NATIVE_TRANSPARENT_COVERAGE,
        border_coverage / _MIN_NATIVE_BORDER_TRANSPARENT_COVERAGE,
    )
    return valid, confidence


def _chroma_opacity(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> float:
    """估算像素相对键色的前景不透明度，结果稳定落在 0–1。

    对每个通道按“键色到该方向 RGB 极值的最大距离”归一化，再取最大偏差。
    这比固定欧氏距离更适合极高饱和度键色：背景轻微漂移仍接近 0，而主体在
    任一通道明显离开键色时就会快速接近 1。
    """
    return max(
        abs(channel - key_channel) / max(key_channel, 255 - key_channel, 1)
        for channel, key_channel in zip(rgb, key, strict=True)
    )


def _estimate_actual_chroma_key(
    image: Image.Image,
    requested_key: tuple[int, int, int],
    border: tuple[tuple[int, int], ...],
) -> tuple[int, int, int] | None:
    """从画布四边估计 AI 真正生成的键色，拒绝覆盖率不足的猜测。

    Seedream 会因色彩管理、压缩或生成式抗锯齿，把 `#00FFFF` 输出成接近但不
    相等的青色。动态键色已经尽量避开主体主色，所以四边中仍靠近请求键色的
    像素可作为可靠样本。逐通道中位数可以抑制主体接边和少量噪点的影响。
    """
    samples: list[tuple[int, int, int]] = []
    for x, y in border:
        red, green, blue, _ = image.getpixel((x, y))
        rgb = (red, green, blue)
        if _chroma_opacity(rgb, requested_key) <= _MAX_KEY_ESTIMATION_OPACITY:
            samples.append(rgb)

    if len(samples) / max(1, len(border)) < _MIN_BORDER_KEY_COVERAGE:
        return None
    return tuple(round(median(channel)) for channel in zip(*samples, strict=True))  # type: ignore[return-value]


def _smoothstep(value: float) -> float:
    """把线性遮罩转成两端平滑的透明度，减少新的锯齿断层。"""
    clamped = min(1.0, max(0.0, value))
    return clamped * clamped * (3.0 - 2.0 * clamped)


def _remove_chroma_spill(
    rgb: tuple[int, int, int],
    key: tuple[int, int, int],
    foreground_fraction: float,
) -> tuple[int, int, int]:
    """按键色合成模型反解前景 RGB，避免半透明边缘继续携带绿/青色。

    假设观测色约等于 `前景 * f + 键色 * (1-f)`。这里的 `f` 是保守估计，
    在极薄边缘可能让颜色更偏离键色，但这比把键色污染量化成实体豆更安全。
    """
    fraction = max(foreground_fraction, 1 / 255)
    return tuple(
        min(255, max(0, round((channel - (1.0 - fraction) * key_channel) / fraction)))
        for channel, key_channel in zip(rgb, key, strict=True)
    )  # type: ignore[return-value]


def _extract_chroma_key(image: Image.Image, chroma_key: str) -> PreparedForeground | None:
    """估计实际键色，生成软 Alpha，并清除边缘键色污染。"""
    output = image.convert("RGBA")
    width, height = output.size
    if width <= 0 or height <= 0:
        output.close()
        return None

    pixels = output.load()
    requested_key = _parse_hex_color(chroma_key)
    border = _border_coordinates(width, height)
    key = _estimate_actual_chroma_key(output, requested_key, border)
    if key is None:
        output.close()
        return None

    def pixel_opacity(x: int, y: int) -> float:
        red, green, blue, alpha = pixels[x, y]
        if alpha < 16:
            return 0.0
        return _chroma_opacity((red, green, blue), key)

    matching_border = sum(
        pixel_opacity(x, y) <= _CHROMA_BACKGROUND_OPACITY for x, y in border
    )
    border_coverage = matching_border / max(1, len(border))
    if border_coverage < _MIN_BORDER_KEY_COVERAGE:
        output.close()
        return None

    # 从可信背景向内遍历“背景 + 键色混合带”，但不穿过明确前景。这样既不会
    # 沿轮廓缺口吞掉白色主体，又能处理旧硬阈值遗漏的青绿色边缘。
    queue: deque[tuple[int, int]] = deque(
        (x, y) for x, y in border if pixel_opacity(x, y) <= _CHROMA_BACKGROUND_OPACITY
    )
    visited = bytearray(width * height)
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        opacity = pixel_opacity(x, y)
        if visited[index] or opacity > _CHROMA_DESPILL_LIMIT:
            continue
        visited[index] = 1
        red, green, blue, source_alpha = pixels[x, y]
        if opacity <= _CHROMA_BACKGROUND_OPACITY:
            output_alpha = 0
        elif opacity >= _CHROMA_FOREGROUND_OPACITY:
            output_alpha = source_alpha
        else:
            normalized = (opacity - _CHROMA_BACKGROUND_OPACITY) / (
                _CHROMA_FOREGROUND_OPACITY - _CHROMA_BACKGROUND_OPACITY
            )
            output_alpha = round(source_alpha * _smoothstep(normalized))

        clean_rgb = _remove_chroma_spill((red, green, blue), key, opacity)
        pixels[x, y] = (*clean_rgb, output_alpha)
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height:
                next_index = next_y * width + next_x
                if not visited[next_index]:
                    queue.append((next_x, next_y))

    foreground_count = sum(
        pixels[x, y][3] >= 128 for y in range(height) for x in range(width)
    )
    foreground_coverage = foreground_count / (width * height)
    if not _MIN_FOREGROUND_COVERAGE <= foreground_coverage <= _MAX_FOREGROUND_COVERAGE:
        output.close()
        return None

    confidence = min(1.0, border_coverage, (1.0 - foreground_coverage) / 0.05)
    return PreparedForeground(
        image=output,
        processing="chroma_key",
        confidence=confidence,
    )


def prepare_foreground(
    source: Image.Image,
    *,
    enhancer: ImageEnhancer,
    options: EnhancementOptions,
) -> PreparedForeground:
    """增强图片并把结果规范化为量化器可直接消费的可信 RGBA 前景。

    这是背景处理的唯一公开接口。调用方不需要了解 Alpha 覆盖率、键色选择、
    flood-fill 或失败阈值。Solid 模式无法得到可信蒙版时，本函数明确失败，禁止
    继续返回豆数错误但表面成功的施工图。
    """
    chroma_key = None
    effective_options = options
    if options.background_mode is BackgroundMode.SOLID:
        chroma_key = _choose_chroma_key(source)
        effective_options = replace(options, chroma_key=chroma_key)

    enhancement = enhancer.enhance(source, options=effective_options)
    enhanced = enhancement.image
    if options.background_mode is not BackgroundMode.SOLID:
        return PreparedForeground(image=enhanced, processing="none", confidence=1.0)

    native_alpha_valid, alpha_confidence = _has_meaningful_native_alpha(enhanced)
    if native_alpha_valid:
        logger.info(
            "Foreground prepared with native alpha",
            extra={
                "foreground_processing": "native_alpha",
                "foreground_confidence": alpha_confidence,
            },
        )
        return PreparedForeground(
            image=enhanced,
            processing="native_alpha",
            confidence=alpha_confidence,
        )

    if chroma_key is not None:
        keyed = _extract_chroma_key(enhanced, chroma_key)
        if keyed is not None:
            if enhanced is not source:
                enhanced.close()
            logger.info(
                "Foreground prepared with chroma key",
                extra={
                    "foreground_processing": "chroma_key",
                    "foreground_confidence": keyed.confidence,
                    "foreground_chroma_key": chroma_key,
                },
            )
            return keyed

    if enhanced is not source:
        enhanced.close()
    logger.warning(
        "Foreground separation rejected unsafe enhancement",
        extra={
            "foreground_processing": "failed",
            "foreground_chroma_key": chroma_key,
        },
    )
    raise ApiError(
        422,
        "AI_BACKGROUND_SEPARATION_FAILED",
        "AI 未能生成可识别的主体背景，请重试或改用保留/简化背景",
    )
