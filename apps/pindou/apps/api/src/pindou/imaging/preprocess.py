"""负责上传图片的安全解码、方向纠正和方形画布适配。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError

from pindou.core.errors import ApiError
from pindou.schemas.conversion import BackgroundMode

SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "MPO"}


@dataclass(frozen=True, slots=True)
class SampledGrid:
    """缩格后的 RGBA 工作图及每格边缘强度。

    `edge_strengths` 与图片扁平像素顺序一致，范围固定为 0..1。该类型只在图像
    模块内部流转，不进入 HTTP 契约，调用方负责关闭 `image`。
    """

    image: Image.Image
    edge_strengths: tuple[float, ...]


def decode_image(content: bytes, *, max_pixels: int) -> Image.Image:
    """安全解码上传内容，并统一返回独立的 RGBA 图片。

    文件扩展名和请求的 Content-Type 都可能伪造，因此这里以 Pillow 实际识别的
    `source.format` 为准。函数会应用 EXIF Orientation，防止手机照片方向错误；
    `convert("RGBA")` 会创建与输入流解耦的新对象，因此退出 `with` 后仍可安全使用。
    """
    try:
        with Image.open(BytesIO(content)) as source:
            # 只接受静态、已明确支持的光栅格式；SVG、GIF 等不会进入后续管线。
            if source.format not in SUPPORTED_FORMATS:
                print(f"Unsupported image format: {source.format}")
                raise ApiError(400, "IMAGE_UNSUPPORTED", "仅支持 JPG、PNG 和 WebP 图片")
            # 压缩文件可能很小但解码后极大，因此必须额外限制宽×高。
            if source.width * source.height > max_pixels:
                raise ApiError(413, "IMAGE_TOO_LARGE", "图片像素数量超过限制")
            # 在输入 BytesIO 关闭前强制读取像素，提前触发截断文件等解码错误。
            source.load()
            transposed = ImageOps.exif_transpose(source)
            return transposed.convert("RGBA")
    except ApiError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ApiError(400, "IMAGE_DECODE_FAILED", "图片无法解码") from exc


def fit_to_square_grid(
    image: Image.Image,
    *,
    grid_size: int,
    background_mode: BackgroundMode,
    background_color: str | None,
) -> SampledGrid:
    """按原始比例把图片放入 N×N 工作画布。

    `ImageOps.contain` 保证不裁剪、不拉伸；所有未覆盖区域都保持透明。
    Solid 的真实背景颜色只在前端渲染层铺设，不能在量化前合成，否则会污染
    前景调色板和豆数统计。原图内部背景的编辑由 ImageEnhancer 完成。
    """
    # 在创建任何 Pillow 临时对象前完成参数校验，确保异常路径不会遗留待关闭图片。
    if (
        background_mode is BackgroundMode.SOLID
        and (background_color is None or re.fullmatch(r"#[0-9A-F]{6}", background_color) is None)
    ):
        raise ApiError(400, "BACKGROUND_COLOR_INVALID", "背景颜色必须为 #RRGGBB")

    # BOX 继续提供稳定的面积平均；LANCZOS 只在高对比边缘按强度混入，避免直接改成
    # 对缩放相位非常敏感的中心点采样，同时减少细轮廓被平均成中间色的概率。
    box_fitted = ImageOps.contain(image, (grid_size, grid_size), method=Image.Resampling.BOX)
    detail_fitted = ImageOps.contain(
        image,
        (grid_size, grid_size),
        method=Image.Resampling.LANCZOS,
    )

    grayscale = image.convert("L")
    try:
        # FIND_EDGES 在源分辨率上提取高频结构，再用 BOX 聚合到目标格，所得灰度值
        # 可以理解为该格覆盖了多少高对比边缘，而不是单个像素是否恰好落在线上。
        source_edges = grayscale.filter(ImageFilter.FIND_EDGES)
        try:
            # FIND_EDGES 会把卷积窗口外默认值视为黑色，从而在平坦图片四周制造一圈
            # 假边缘。显式清零最外圈，避免背景边框获得不应有的轮廓权重。
            edge_draw = ImageDraw.Draw(source_edges)
            edge_draw.rectangle(
                (0, 0, source_edges.width - 1, source_edges.height - 1),
                outline=0,
                width=1,
            )
            edge_fitted = ImageOps.contain(
                source_edges,
                (grid_size, grid_size),
                method=Image.Resampling.BOX,
            )
        finally:
            source_edges.close()
    finally:
        grayscale.close()

    # 边缘图直接作为逐像素混合蒙版：低梯度区域几乎完全使用 BOX，高梯度区域更多
    # 使用 LANCZOS 的局部结构。Alpha 始终取 BOX 结果，防止锐化细节改变豆子占用。
    fitted = Image.composite(detail_fitted, box_fitted, edge_fitted)
    box_alpha = box_fitted.getchannel("A")
    try:
        fitted.putalpha(box_alpha)
    finally:
        box_alpha.close()
    # 使用整数左上角坐标居中；奇数差值多出的 1 像素自然落在右侧或下侧。
    left = (grid_size - fitted.width) // 2
    top = (grid_size - fitted.height) // 2

    try:
        # 透明画布让 Alpha 成为唯一的前景/空格边界；Canvas 渲染时再单独铺 Solid 背景。
        canvas = Image.new("RGBA", (grid_size, grid_size), (0, 0, 0, 0))
        canvas.alpha_composite(fitted, (left, top))
        edge_canvas = Image.new("L", (grid_size, grid_size), 0)
        try:
            edge_canvas.paste(edge_fitted, (left, top))
            # 缩格会按目标格面积稀释窄线的边缘响应。例如一条覆盖约 20% 格宽的
            # 双边线，原始响应通常只有约 0.1。以 64 为满强度做线性归一并裁剪，
            # 让这类可制作轮廓获得约 0.4 的权重，同时仍限制在 0..1。
            edge_strengths = tuple(
                min(1.0, value / 64.0) for value in edge_canvas.get_flattened_data()
            )
        finally:
            edge_canvas.close()
        return SampledGrid(image=canvas, edge_strengths=edge_strengths)
    finally:
        fitted.close()
        box_fitted.close()
        detail_fitted.close()
        edge_fitted.close()
