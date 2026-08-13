"""负责上传图片的安全解码、方向纠正和方形画布适配。"""

from __future__ import annotations

import re
from io import BytesIO

from PIL import Image, ImageColor, ImageOps, UnidentifiedImageError

from pindou.core.errors import ApiError
from pindou.schemas.conversion import BackgroundMode

SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}


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
) -> Image.Image:
    """按原始比例把图片放入 N×N 工作画布。

    `ImageOps.contain` 保证不裁剪、不拉伸；未覆盖区域作为补边。MVP1 的 keep 与
    transparent 对补边都使用透明色，区别只体现在原图已有 Alpha 会被保留；它们
    都不会替 JPG 自动抠图。solid 则先铺满用户纯色，再合成原图。
    """
    # BOX 重采样适合把大量源像素平均压缩到一颗拼豆格，减少单点采样偏色。
    fitted = ImageOps.contain(image, (grid_size, grid_size), method=Image.Resampling.BOX)
    # 使用整数左上角坐标居中；奇数差值多出的 1 像素自然落在右侧或下侧。
    left = (grid_size - fitted.width) // 2
    top = (grid_size - fitted.height) // 2

    if background_mode is BackgroundMode.SOLID:
        # 先用正则严格限制 #RRGGBB，避免 Pillow 接受颜色名或其他非契约格式。
        if background_color is None or re.fullmatch(r"#[0-9A-Fa-f]{6}", background_color) is None:
            raise ApiError(400, "BACKGROUND_COLOR_INVALID", "纯色背景必须提供颜色")
        try:
            red, green, blue = ImageColor.getrgb(background_color)
        except ValueError as exc:
            raise ApiError(400, "BACKGROUND_COLOR_INVALID", "背景颜色必须为 #RRGGBB") from exc
        canvas = Image.new("RGBA", (grid_size, grid_size), (red, green, blue, 255))
        # alpha_composite 正确处理原图的半透明边缘，不产生黑边或白边。
        canvas.alpha_composite(fitted, (left, top))
        return canvas

    # keep/transparent 的补边透明；原图自身的不透明背景仍然保留。
    canvas = Image.new("RGBA", (grid_size, grid_size), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, (left, top))
    return canvas
