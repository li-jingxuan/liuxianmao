from __future__ import annotations

from pindou.api.dependencies import get_color_chart
from pindou.color.chart import group_colors_by_series


def test_color_chart_has_expected_common_sets() -> None:
    """源色卡应包含 11 个声明数量与实际成员数量一致的常见套装。"""
    chart = get_color_chart()

    assert chart.schema_version == "1.0"
    assert chart.set_sizes == (24, 48, 72, 96, 120, 144, 168, 192, 216, 221, 264)
    for size in chart.set_sizes:
        color_set = chart.get_set(size)
        assert color_set is not None
        assert len(color_set.colors) == size
        assert len({color.code for color in color_set.colors}) == size


def test_color_chart_preserves_colors_and_groups_by_source_series() -> None:
    """全量目录按源文件顺序保留 291 色，并正确处理 ZG 双字母系列。"""
    chart = get_color_chart()

    assert len(chart.colors) == len(chart.colors_by_code) == 291
    assert chart.colors[0].code == "A1"
    assert chart.colors[-1].code == "ZG8"
    assert chart.colors_by_code["A1"].series == "A"
    assert chart.colors_by_code["ZG8"].series == "ZG"

    groups = group_colors_by_series(chart.colors)
    assert [series for series, _ in groups] == [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "M",
        "P",
        "Q",
        "R",
        "T",
        "Y",
        "ZG",
    ]
    assert {series: len(colors) for series, colors in groups} == {
        "A": 26,
        "B": 32,
        "C": 29,
        "D": 26,
        "E": 24,
        "F": 25,
        "G": 21,
        "H": 23,
        "M": 15,
        "P": 23,
        "Q": 5,
        "R": 28,
        "T": 1,
        "Y": 5,
        "ZG": 8,
    }


def test_merchant_color_sets_are_cumulative() -> None:
    """商家分盒套装保持累计语义；独立的标准 221 色套装不参与此断言。"""
    chart = get_color_chart()
    previous_codes: set[str] = set()

    for size in (24, 48, 72, 96, 120, 144, 168, 192, 216, 264):
        color_set = chart.get_set(size)
        assert color_set is not None
        current_codes = {color.code for color in color_set.colors}
        assert previous_codes <= current_codes
        previous_codes = current_codes


def test_standard_221_set_contains_all_standard_series() -> None:
    """221 色标准套装应精确覆盖 A–H、M 九个标准系列。"""
    chart = get_color_chart()
    color_set = chart.get_set(221)

    assert color_set is not None
    expected_codes = {
        code
        for code in chart.colors_by_code
        if code[0] in {"A", "B", "C", "D", "E", "F", "G", "H", "M"}
    }
    assert len(expected_codes) == 221
    assert {color.code for color in color_set.colors} == expected_codes
