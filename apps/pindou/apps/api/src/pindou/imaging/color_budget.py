"""根据网格承载能力解析转换流程唯一的有效颜色预算。"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

COLOR_BUDGET_POLICY_VERSION = "grid-color-budget-v2"


class ColorBudgetBand(StrEnum):
    """供 Seedream Prompt 使用的颜色表达档位。"""

    RESTRAINED = "restrained"
    BALANCED = "balanced"
    RICH = "rich"


class GridDetailBand(StrEnum):
    """最终网格可承载的视觉细节档位。"""

    MICRO = "micro"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


AUTO_MAX_COLORS_BY_GRID_BAND: dict[GridDetailBand, int] = {
    GridDetailBand.MICRO: 8,
    GridDetailBand.SMALL: 30,
    GridDetailBand.MEDIUM: 54,
    GridDetailBand.LARGE: 54,
}

PROMPT_BAND_BY_GRID_BAND: dict[GridDetailBand, ColorBudgetBand] = {
    GridDetailBand.MICRO: ColorBudgetBand.RESTRAINED,
    GridDetailBand.SMALL: ColorBudgetBand.BALANCED,
    GridDetailBand.MEDIUM: ColorBudgetBand.RICH,
    GridDetailBand.LARGE: ColorBudgetBand.RICH,
}


@dataclass(frozen=True, slots=True)
class ResolvedColorBudget:
    """一次转换实际采用的颜色上限、来源和 Prompt 档位。"""

    mode: Literal["auto", "legacy-explicit"]
    policy_version: str
    effective_max_colors: int
    prompt_band: ColorBudgetBand


def classify_grid_detail(grid_size: int) -> GridDetailBand:
    """把路由已校验的连续网格尺寸映射到有限细节档位。"""
    if grid_size <= 31:
        return GridDetailBand.MICRO
    if grid_size <= 63:
        return GridDetailBand.SMALL
    if grid_size <= 95:
        return GridDetailBand.MEDIUM
    return GridDetailBand.LARGE


def classify_color_budget(effective_max_colors: int) -> ColorBudgetBand:
    """把确定性颜色上限映射到有限的 Prompt 颜色档位。"""
    if effective_max_colors <= 11:
        return ColorBudgetBand.RESTRAINED
    if effective_max_colors <= 17:
        return ColorBudgetBand.BALANCED
    return ColorBudgetBand.RICH


def resolve_color_budget(
    *,
    grid_size: int,
    color_set_size: int,
    legacy_max_colors: int | None,
) -> ResolvedColorBudget:
    """兼容显式旧参数；缺失时按网格大小自动派生并收紧颜色预算。"""
    planned_max_colors = (
        legacy_max_colors
        if legacy_max_colors is not None
        else AUTO_MAX_COLORS_BY_GRID_BAND[classify_grid_detail(grid_size)]
    )
    effective_max_colors = min(planned_max_colors, color_set_size, grid_size * grid_size)
    return ResolvedColorBudget(
        mode="legacy-explicit" if legacy_max_colors is not None else "auto",
        policy_version=COLOR_BUDGET_POLICY_VERSION,
        effective_max_colors=effective_max_colors,
        # Prompt 只表达网格可承载的颜色丰富度，不直接追随 30/54 的量化硬上限。
        prompt_band=PROMPT_BAND_BY_GRID_BAND[classify_grid_detail(grid_size)],
    )
