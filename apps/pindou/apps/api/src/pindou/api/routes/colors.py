"""向前端公开按色号系列分组的完整 MARD 色卡。"""

from __future__ import annotations

from fastapi import APIRouter

from pindou.api.dependencies import ColorChartDep
from pindou.color.chart import MardColor, group_colors_by_series
from pindou.schemas.color_catalog import (
    CatalogColor,
    ColorCatalogResponse,
    ColorSeriesGroup,
    ColorSetGroup,
)

router = APIRouter(prefix="/colors", tags=["colors"])


@router.get("")
def list_colors(chart: ColorChartDep) -> ColorCatalogResponse:
    """返回完整色卡，并提供系列与套装两种稳定分组。"""
    def to_catalog_color(color: MardColor) -> CatalogColor:
        return CatalogColor(code=color.code, hex=color.hex, rgb=color.rgb)

    groups = [
        ColorSeriesGroup(
            series=series,
            label=f"{series} 系列",
            color_count=len(series_colors),
            colors=[to_catalog_color(color) for color in series_colors],
        )
        for series, series_colors in group_colors_by_series(chart.colors)
    ]
    sets = [
        ColorSetGroup(
            size=color_set.size,
            label=f"MARD {color_set.size}色套装",
            color_count=len(color_set.colors),
            colors=[to_catalog_color(color) for color in color_set.colors],
        )
        for color_set in (chart.sets_by_size[size] for size in chart.set_sizes)
    ]
    return ColorCatalogResponse(
        schema_version=chart.schema_version,
        total_count=len(chart.colors),
        groups=groups,
        sets=sets,
    )
