"""图片上传、参数校验和拼豆网格转换路由。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from pindou.api.dependencies import ColorChartDep, ImageEnhancerDep, SettingsDep
from pindou.core.errors import ApiError
from pindou.imaging.grid import build_bead_grid
from pindou.imaging.preprocess import decode_image
from pindou.schemas.conversion import (
    BackgroundMode,
    ConversionMeta,
    ConversionResponse,
    PaletteColor,
)

router = APIRouter(prefix="/conversions", tags=["conversions"])


@router.post("")
def create_conversion(
    image: Annotated[UploadFile, File()],
    grid_size: Annotated[int, Form()],
    max_colors: Annotated[int, Form()],
    color_set_size: Annotated[int, Form()],
    background_mode: Annotated[BackgroundMode, Form()] = BackgroundMode.KEEP,
    background_color: Annotated[str | None, Form()] = None,
    *,
    chart: ColorChartDep,
    enhancer: ImageEnhancerDep,
    app_settings: SettingsDep,
) -> ConversionResponse:
    """把上传图片转换为受指定 MARD 颜色组约束的方形拼豆网格。

    此端点使用普通同步函数：Pillow 解码和颜色量化都是阻塞型 CPU 工作，FastAPI
    会把同步路由放在线程池执行。MVP1 不保存图片，也不返回 PNG；响应只包含前端
    Canvas 渲染所需的调色板和位置矩阵。
    """
    # 第一层先验证低成本的表单参数，避免非法请求进入图片解码和量化阶段。
    if not app_settings.min_grid_size <= grid_size <= app_settings.max_grid_size:
        raise ApiError(
            400,
            "GRID_SIZE_INVALID",
            f"网格尺寸必须在 {app_settings.min_grid_size} 到 {app_settings.max_grid_size} 之间",
        )
    if not 8 <= max_colors <= 24:
        raise ApiError(400, "MAX_COLORS_INVALID", "最大颜色数必须在 8 到 24 之间")
    if chart.get_set(color_set_size) is None:
        raise ApiError(400, "COLOR_SET_INVALID", "请选择有效的 MARD 颜色组")

    # 只读取“上限 + 1”字节即可判断超限，避免把任意大文件完整读入内存。
    content = image.file.read(app_settings.upload_max_bytes + 1)
    if len(content) > app_settings.upload_max_bytes:
        raise ApiError(413, "IMAGE_TOO_LARGE", "图片文件超过 10 MiB 限制")
    if not content:
        raise ApiError(400, "IMAGE_DECODE_FAILED", "图片内容为空")

    # 解码阶段会验证真实图片格式、应用 EXIF 方向并统一转换为 RGBA。
    decoded = decode_image(content, max_pixels=app_settings.upload_max_pixels)
    enhanced = decoded
    try:
        # MVP1 返回原对象；未来的 Seedream 实现可以返回一个新的 Pillow Image。
        enhanced = enhancer.enhance(decoded)
        grid = build_bead_grid(
            enhanced,
            chart=chart,
            grid_size=grid_size,
            max_colors=max_colors,
            color_set_size=color_set_size,
            background_mode=background_mode,
            background_color=background_color,
        )
    finally:
        # 无论量化成功还是失败，都关闭所有 Pillow 对象，防止文件句柄和内存泄漏。
        # 如果增强器返回原对象，只关闭一次；返回新对象时则分别关闭。
        if enhanced is not decoded:
            enhanced.close()
        decoded.close()

    # 在 HTTP 边界把内部不可变 tuple 模型转换为 JSON 友好的 list/Pydantic 模型。
    return ConversionResponse(
        width=grid.width,
        height=grid.height,
        palette=[
            PaletteColor(
                id=index,
                code=color.code,
                hex=color.hex,
                rgb=color.rgb,
            )
            for index, color in enumerate(grid.palette)
        ],
        rows=[list(row) for row in grid.rows],
        meta=ConversionMeta(
            # 回传约束与色卡版本，便于前端展示和未来复现结果。
            color_set_size=color_set_size,
            color_chart_version=chart.schema_version,
            actual_color_count=len(grid.palette),
        ),
    )
