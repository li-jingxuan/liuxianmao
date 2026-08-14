"""MARD 全量色卡目录接口的公开 Pydantic 契约。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CatalogColor(BaseModel):
    """色卡目录中用于展示的单个颜色。"""

    code: str = Field(min_length=1)
    hex: str = Field(pattern=r"^#[0-9A-F]{6}$")
    rgb: tuple[int, int, int]


class ColorSeriesGroup(BaseModel):
    """一个 MARD 色号系列及其全部颜色。"""

    series: str = Field(min_length=1)
    label: str = Field(min_length=1)
    color_count: int = Field(ge=1)
    colors: list[CatalogColor]


class ColorCatalogResponse(BaseModel):
    """按色号系列分组的完整 MARD 色卡。"""

    brand: Literal["MARD"] = "MARD"
    schema_version: str
    total_count: int = Field(ge=1)
    groups: list[ColorSeriesGroup]
