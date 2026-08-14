from __future__ import annotations

from PIL import Image

from pindou.api.dependencies import get_color_chart
from pindou.imaging.quantize import quantize_to_mard_grid


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


def test_transparent_pixels_use_negative_one() -> None:
    """全透明图片不应产生任何虚假 MARD 色号，所有格子均为 -1。"""
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
    assert all(cell == -1 for row in result.rows for cell in row)


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

    assert result.rows[0][0] == -1
    assert result.rows[0][1] == 0
    assert len(result.palette) == 1
