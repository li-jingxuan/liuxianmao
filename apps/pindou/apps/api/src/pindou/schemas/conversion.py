"""颜色组查询和图片转换接口的公开 Pydantic 契约。"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class BackgroundMode(StrEnum):
    """AI 编辑原图背景的产品策略。"""

    SIMPLIFY = "simplify"
    KEEP = "keep"
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

    enhancer: Literal["passthrough", "seedream-5-lite"]
    enhancer_model: str | None = None
    enhancer_prompt_version: str | None = None
    background_mode: BackgroundMode
    background_color: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-F]{6}$",
        exclude_if=lambda value: value is None,
    )
    # 记录 Solid 背景实际采用的分离路径，便于定位上游 Alpha 能力差异：
    # none 表示 keep/simplify，native_alpha 表示上游已有透明区域，edge_flood_fill
    # 表示服务端从不透明/无 Alpha 的 AI 输出中抠除了边缘背景。
    background_processing: Literal["none", "native_alpha", "edge_flood_fill"] = "none"
    palette_brand: Literal["MARD"] = "MARD"
    color_set_size: int
    color_budget_mode: Literal["auto", "legacy-explicit"]
    color_budget_policy_version: str
    effective_max_colors: int = Field(ge=0)
    color_chart_version: str
    # 颜色数量现在只统计前景，不包含 Solid 渲染背景。
    actual_color_count: int = Field(ge=0)


class ForegroundGrid(BaseModel):
    """主体拼豆层；rows 中的 null 表示不放主体豆。"""

    palette: list[PaletteColor]
    rows: list[list[int | None]]


class RenderBackground(BaseModel):
    """仅供 Canvas/PNG 铺底的背景层，不参与颜色量化。"""

    mode: Literal["solid", "none"]
    color: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-F]{6}$",
        exclude_if=lambda value: value is None,
    )


class ConversionStats(BaseModel):
    """主体制作统计，不把渲染背景计入豆数或颜色数。"""

    bead_count: int = Field(ge=0)
    color_count: int = Field(ge=0)


class ConversionResponse(BaseModel):
    """图片转换成功后的公开网格契约。

    `foreground.rows[y][x]` 为主体 palette 索引，null 表示不放主体豆。
    `background` 是独立渲染层，后端不返回或保存 PNG，Next.js 使用这份数据
    完成 Canvas 预览和浏览器导出。
    """

    # schema_version 描述 JSON 形状；algorithm_version 描述量化行为。
    schema_version: Literal["3"] = "3"
    algorithm_version: Literal["bead-grid-constrained-v2"] = "bead-grid-constrained-v2"
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    foreground: ForegroundGrid
    background: RenderBackground
    meta: ConversionMeta
    stats: ConversionStats


class ColorSetOption(BaseModel):
    """颜色组选择器中的一项。"""

    size: int = Field(ge=1)
    label: str
    color_count: int = Field(ge=1)


class ColorSetsResponse(BaseModel):
    """由 MARD 色卡 sets[] 动态生成的颜色套装列表。"""

    brand: Literal["MARD"] = "MARD"
    schema_version: str
    default_size: int
    sets: list[ColorSetOption]


class HealthResponse(BaseModel):
    """轻量健康检查响应。"""

    status: Literal["ok"] = "ok"
