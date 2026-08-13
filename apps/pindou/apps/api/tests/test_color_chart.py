from __future__ import annotations

from pindou.api.dependencies import get_color_chart


def test_color_chart_has_expected_cumulative_sets() -> None:
    """源色卡应包含 11 个声明数量与实际成员数量一致的累计套装。"""
    chart = get_color_chart()

    assert chart.schema_version == "1.0"
    assert chart.set_sizes == (24, 48, 72, 96, 120, 144, 168, 192, 216, 240, 264)
    for size in chart.set_sizes:
        color_set = chart.get_set(size)
        assert color_set is not None
        assert len(color_set.colors) == size
        assert len({color.code for color in color_set.colors}) == size


def test_smaller_color_sets_are_subsets_of_larger_sets() -> None:
    """验证“累计颜色组”语义：小套装中的每个色号都应保留在更大套装中。"""
    chart = get_color_chart()
    previous_codes: set[str] = set()

    for size in chart.set_sizes:
        color_set = chart.get_set(size)
        assert color_set is not None
        current_codes = {color.code for color in color_set.colors}
        assert previous_codes <= current_codes
        previous_codes = current_codes
