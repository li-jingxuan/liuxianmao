"""颜色组查询和图片转换接口的公开 Pydantic 契约。"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class BackgroundMode(StrEnum):
    """方形工作画布未被原图覆盖区域的处理方式。"""

    # keep 保留原图本身的背景和 Alpha；它不会对 JPG 自动抠图。
    KEEP = "keep"
    # transparent 使用透明补边；原图本身已有的背景仍然保留。
    TRANSPARENT = "transparent"
    # solid 使用 background_color 铺满补边区域。
    SOLID = "solid"


class PaletteColor(BaseModel):
    """前端渲染和展示用的单个实际 MARD 色号。"""

    # id 同时是 rows 中存放的调色板索引，必须从 0 连续递增。
    id: int = Field(ge=0)
    brand: Literal["MARD"] = "MARD"
    code: str = Field(min_length=1)
    hex: str = Field(pattern=r"^#[0-9A-F]{6}$")
    rgb: tuple[int, int, int]


class ConversionMeta(BaseModel):
    """描述本次量化约束和可复现版本的元数据。"""

    enhancer: Literal["passthrough"] = "passthrough"
    palette_brand: Literal["MARD"] = "MARD"
    color_set_size: int
    color_chart_version: str
    actual_color_count: int = Field(ge=0)


class ConversionResponse(BaseModel):
    """图片转换成功后的公开网格契约。

    `rows[y][x]` 为 `palette` 索引，-1 表示透明格。后端不返回或保存 PNG，
    Next.js 使用这份数据完成 Canvas 预览和浏览器导出。
    """

    # schema_version 描述 JSON 形状；algorithm_version 描述量化行为。
    schema_version: Literal["1"] = "1"
    algorithm_version: Literal["bead-grid-v1"] = "bead-grid-v1"
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    palette: list[PaletteColor]
    rows: list[list[int]]
    meta: ConversionMeta


class ColorSetOption(BaseModel):
    """颜色组选择器中的一项。"""

    size: int = Field(ge=1)
    label: str
    color_count: int = Field(ge=1)


class ColorSetsResponse(BaseModel):
    """由 MARD 色卡 sets[] 动态生成的累计颜色组列表。"""

    brand: Literal["MARD"] = "MARD"
    schema_version: str
    default_size: int
    sets: list[ColorSetOption]


class HealthResponse(BaseModel):
    """轻量健康检查响应。"""

    status: Literal["ok"] = "ok"
