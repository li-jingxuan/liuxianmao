from __future__ import annotations

import pytest

from pindou.color.chart import LabColor
from pindou.color.distance import ciede2000, srgb_to_lab


def test_ciede2000_matches_reference_pair() -> None:
    """使用公开标准参考对锁定 CIEDE2000 实现，避免公式重构后悄然偏差。"""
    first = LabColor(50.0, 2.6772, -79.7751)
    second = LabColor(50.0, 0.0, -82.7485)

    assert ciede2000(first, second) == pytest.approx(2.0425, abs=0.0001)


def test_srgb_white_maps_to_d65_lab() -> None:
    """D65 sRGB 白色应落在 Lab(100, 0, 0) 附近。"""
    white = srgb_to_lab((255, 255, 255))

    assert white.lightness == pytest.approx(100.0, abs=0.001)
    assert white.a == pytest.approx(0.0, abs=0.001)
    assert white.b == pytest.approx(0.0, abs=0.001)
