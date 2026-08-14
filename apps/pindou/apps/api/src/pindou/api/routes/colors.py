"""向前端公开按色号系列分组的完整 MARD 色卡。"""

from __future__ import annotations

from fastapi import APIRouter

from pindou.api.dependencies import ColorChartDep
from pindou.color.chart import group_colors_by_series
from pindou.schemas.color_catalog import (
    CatalogColor,
    ColorCatalogResponse,
    ColorSeriesGroup,
)

router = APIRouter(prefix="/colors", tags=["colors"])


@router.get("")
def list_colors(chart: ColorChartDep) -> ColorCatalogResponse:
    """返回完整色卡，系列和颜色顺序与源色卡保持一致。"""
    groups = [
        ColorSeriesGroup(
            series=series,
            label=f"{series} 系列",
            color_count=len(series_colors),
            colors=[
                CatalogColor(code=color.code, hex=color.hex, rgb=color.rgb)
                for color in series_colors
            ],
        )
        for series, series_colors in group_colors_by_series(chart.colors)
    ]
    return ColorCatalogResponse(
        schema_version=chart.schema_version,
        total_count=len(chart.colors),
        groups=groups,
    )
