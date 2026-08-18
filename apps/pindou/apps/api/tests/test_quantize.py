from __future__ import annotations

from PIL import Image

from pindou.api.dependencies import get_color_chart
from pindou.color.chart import MardColor, MardColorChart, MardColorSet
from pindou.color.distance import srgb_to_lab
from pindou.imaging.preprocess import remove_connected_solid_background
from pindou.imaging.quantize import quantize_to_mard_grid


def test_solid_background_removal_keeps_disconnected_white_subject_pixels() -> None:
    """边缘白底应变透明，但被主体包围的白色高光仍需保留。"""
    image = Image.new("RGBA", (7, 7), (255, 255, 255, 255))
    for y in range(1, 6):
        for x in range(1, 6):
            image.putpixel((x, y), (220, 40, 40, 255))
    image.putpixel((3, 3), (255, 255, 255, 255))

    result = remove_connected_solid_background(image)

    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((3, 3))[3] == 255
    assert result.getpixel((1, 1))[3] == 255
    result.close()
    image.close()


def test_solid_background_removal_handles_compressed_near_white_edges() -> None:
    """AI/JPEG 造成的轻微白底偏色也应在阈值内被抠除。"""
    image = Image.new("RGBA", (4, 4), (247, 249, 246, 255))
    image.putpixel((1, 1), (24, 120, 220, 255))

    result = remove_connected_solid_background(image, color_distance_threshold=42)

    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((1, 1))[3] == 255
    result.close()
    image.close()


def test_quantization_only_uses_selected_color_set() -> None:
    """C4 属于 120 色组但不属于 24 色组，用它证明白名单在匹配前生效。"""
    chart = get_color_chart()
    c4 = chart.colors_by_code["C4"]
    image = Image.new("RGBA", (8, 8), (*c4.rgb, 255))

    result_24 = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=24,
        effective_max_colors=8,
    )
    result_120 = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=120,
        effective_max_colors=8,
    )
    image.close()

    allowed_24 = {color.code for color in chart.get_set(24).colors}  # type: ignore[union-attr]
    assert {color.code for color in result_24.palette} <= allowed_24
    assert "C4" not in {color.code for color in result_24.palette}
    assert [color.code for color in result_120.palette] == ["C4"]


def test_transparent_pixels_use_none() -> None:
    """全透明图片不应产生任何虚假 MARD 色号，所有格子均为空位 None。"""
    chart = get_color_chart()
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))

    result = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=24,
        effective_max_colors=8,
    )
    image.close()

    assert result.palette == ()
    assert all(cell is None for row in result.rows for cell in row)
    assert result.bead_count == 0
    assert result.color_count == 0


def test_alpha_coverage_is_resolved_to_binary_bead_occupancy() -> None:
    """半透明像素必须按 50% 覆盖率变成空格或实体豆，不能产生透明豆。"""
    chart = get_color_chart()
    image = Image.new("RGBA", (2, 1))
    image.putdata(((255, 0, 0, 127), (255, 0, 0, 128)))

    result = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=24,
        effective_max_colors=8,
    )
    image.close()

    assert result.rows[0][0] is None
    assert result.rows[0][1] == 0
    assert len(result.palette) == 1


def test_palette_is_optimized_directly_over_allowed_mard_colors() -> None:
    """这个已计算样例的最佳二色组合是绿+灰，Median Cut 后投影会选成蓝+白。"""
    candidate_rgbs = (
        (0, 0, 0),
        (255, 255, 255),
        (255, 0, 0),
        (0, 255, 0),
        (0, 0, 255),
        (128, 128, 128),
    )
    colors = tuple(
        MardColor(
            code=f"C{index}",
            series="C",
            hex=f"#{red:02X}{green:02X}{blue:02X}",
            rgb=rgb,
            lab=srgb_to_lab(rgb),
        )
        for index, rgb in enumerate(candidate_rgbs)
        for red, green, blue in (rgb,)
    )
    chart = MardColorChart(
        schema_version="test",
        colors=colors,
        colors_by_code={color.code: color for color in colors},
        sets_by_size={6: MardColorSet(size=6, colors=colors)},
    )
    source_colors = (
        ((22, 61, 102), 3),
        ((201, 177, 148), 7),
        ((75, 133, 55), 1),
        ((133, 210, 167), 7),
    )
    pixels = tuple((*rgb, 255) for rgb, count in source_colors for _ in range(count))
    image = Image.new("RGBA", (len(pixels), 1))
    image.putdata(pixels)

    result = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=6,
        effective_max_colors=2,
    )
    image.close()

    assert {color.code for color in result.palette} == {"C3", "C5"}


def test_quantization_is_deterministic_and_reports_internal_metrics() -> None:
    chart = get_color_chart()
    image = Image.new("RGBA", (4, 1))
    image.putdata(
        (
            (255, 0, 0, 255),
            (0, 255, 0, 255),
            (255, 255, 255, 0),
            (0, 0, 255, 255),
        )
    )

    first = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=24,
        effective_max_colors=8,
    )
    second = quantize_to_mard_grid(
        image,
        chart=chart,
        color_set_size=24,
        effective_max_colors=8,
    )
    image.close()

    assert first == second
    assert first.algorithm_version == "bead-grid-constrained-v2"
    assert first.effective_max_colors == 3
    assert first.metrics.occupied_cell_count == 3
    assert first.metrics.transparent_cell_count == 1
    assert first.metrics.observation_count == 3
    assert first.metrics.mean_delta_e00 >= 0
    assert first.metrics.p90_delta_e00 >= 0
    assert first.metrics.greedy_round_count == len(first.palette)
    assert 0 <= first.metrics.accepted_swap_count <= 2


def test_transparent_hidden_rgb_does_not_affect_palette_selection() -> None:
    chart = get_color_chart()
    first_image = Image.new("RGBA", (2, 1))
    first_image.putdata(((220, 30, 30, 255), (255, 255, 255, 0)))
    second_image = Image.new("RGBA", (2, 1))
    second_image.putdata(((220, 30, 30, 255), (0, 0, 0, 0)))

    results = tuple(
        quantize_to_mard_grid(
            image,
            chart=chart,
            color_set_size=24,
            effective_max_colors=8,
        )
        for image in (first_image, second_image)
    )
    first_image.close()
    second_image.close()

    assert results[0].palette == results[1].palette
    assert results[0].rows == results[1].rows
