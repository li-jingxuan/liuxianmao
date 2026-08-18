"""负责上传图片的安全解码、方向纠正和方形画布适配。"""

from __future__ import annotations

import re
from collections import deque
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from pindou.core.errors import ApiError
from pindou.schemas.conversion import BackgroundMode

SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "MPO"}


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
) -> Image.Image:
    """按原始比例把图片放入 N×N 工作画布。

    `ImageOps.contain` 保证不裁剪、不拉伸；所有未覆盖区域都保持透明。
    Solid 的真实背景颜色只在前端渲染层铺设，不能在量化前合成，否则会污染
    前景调色板和豆数统计。原图内部背景的编辑由 ImageEnhancer 完成。
    """
    # BOX 重采样适合把大量源像素平均压缩到一颗拼豆格，减少单点采样偏色。
    fitted = ImageOps.contain(image, (grid_size, grid_size), method=Image.Resampling.BOX)
    # 使用整数左上角坐标居中；奇数差值多出的 1 像素自然落在右侧或下侧。
    left = (grid_size - fitted.width) // 2
    top = (grid_size - fitted.height) // 2

    if (
        background_mode is BackgroundMode.SOLID
        and (background_color is None or re.fullmatch(r"#[0-9A-F]{6}", background_color) is None)
    ):
        raise ApiError(400, "BACKGROUND_COLOR_INVALID", "背景颜色必须为 #RRGGBB")
    try:
        # 透明画布让 Alpha 成为唯一的前景/空格边界；Canvas 渲染时再单独铺 Solid 背景。
        canvas = Image.new("RGBA", (grid_size, grid_size), (0, 0, 0, 0))
        canvas.alpha_composite(fitted, (left, top))
        return canvas
    finally:
        fitted.close()


def remove_connected_solid_background(
    image: Image.Image,
    *,
    color_distance_threshold: int = 42,
    alpha_threshold: int = 128,
) -> Image.Image:
    """抠除与图片边缘连通的近似纯色背景，并保留主体内部同色区域。

    Seedream 当前经常返回不透明白底，即使 Prompt 要求透明 Alpha。这里不再把
    “是否透明”交给上游决定：以四边最常见颜色作为背景参考，只从边缘做 flood-fill，
    因此主体内部的白色衣物、高光不会因为颜色相同而整体消失。
    """
    # 阈值使用 RGB 欧氏距离，255 是单通道最大值；显式校验可以避免部署配置
    # 误填负数或过大值后把整张图片误判成背景。
    if color_distance_threshold < 0 or color_distance_threshold > 255:
        raise ValueError("背景颜色距离阈值必须在 0 到 255 之间")
    # 与量化器保持相同的 Alpha 占用边界：低于该值的像素本来就不会生成拼豆。
    if alpha_threshold < 0 or alpha_threshold > 255:
        raise ValueError("Alpha 阈值必须在 0 到 255 之间")

    # convert() 返回独立图片，调用方可以安全关闭输入对象；背景抠除不会污染
    # 备份或其他仍持有原图引用的流程。
    output = image.convert("RGBA")
    width, height = output.size
    if width == 0 or height == 0:
        return output

    pixels = output.load()
    # 只采集四条边，不采集整张图：背景必须从边缘可达，主体内部同色区域才会
    # 因为被主体包围而保留下来。四角只出现一次，避免对参考色产生额外权重。
    border_colors = [
        pixels[x, y][:3]
        for x, y in (
            [(x, 0) for x in range(width)]
            + [(x, height - 1) for x in range(width)]
            + [(0, y) for y in range(1, height - 1)]
            + [(width - 1, y) for y in range(1, height - 1)]
        )
        if pixels[x, y][3] >= alpha_threshold
    ]
    # 如果边缘全部透明，说明上游已经提供了可靠的透明轮廓，此处无需猜测背景色。
    if not border_colors:
        return output

    # 16 档量化直方图比单点取样稳定，能抵抗 AI 白底上的轻微压缩噪声。
    histogram: dict[tuple[int, int, int], int] = {}
    for red, green, blue in border_colors:
        bucket = (red // 16, green // 16, blue // 16)
        histogram[bucket] = histogram.get(bucket, 0) + 1
    # 选择出现次数最多的桶作为背景参考，而不是取左上角像素，避免单个边缘噪点
    # 或主体碰到角落时把错误颜色扩散到整条 flood-fill 路径。
    reference_bucket = max(histogram, key=histogram.__getitem__)
    reference = tuple(channel * 16 + 8 for channel in reference_bucket)
    threshold_squared = color_distance_threshold**2

    def is_background(x: int, y: int) -> bool:
        red, green, blue, alpha = pixels[x, y]
        if alpha < alpha_threshold:
            return False
        # 使用平方距离避免 sqrt；判断结果与真实欧氏距离完全等价。
        distance_squared = sum(
            (channel - expected) ** 2
            for channel, expected in zip((red, green, blue), reference, strict=True)
        )
        return distance_squared <= threshold_squared

    # 队列只保存“从边缘发现、待确认”的坐标；visited 用一维 bytearray 降低
    # Python 元组集合在高分辨率图片上的额外内存开销。
    queue: deque[tuple[int, int]] = deque()
    visited = bytearray(width * height)
    # 以四边作为 flood-fill 的种子。主体如果与画布边缘相连，算法会保守地把
    # 相近颜色视为背景，这是纯色抠除方案无法解决的固有边界，需通过样例调阈值。
    for x, y in (
        [(x, 0) for x in range(width)]
        + [(x, height - 1) for x in range(width)]
        + [(0, y) for y in range(1, height - 1)]
        + [(width - 1, y) for y in range(1, height - 1)]
    ):
        if is_background(x, y):
            queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        # 非背景像素可能被多个邻居重复入队，因此必须在出队时再次判断颜色和访问状态。
        if visited[index] or not is_background(x, y):
            continue
        visited[index] = 1
        red, green, blue, _ = pixels[x, y]
        # 只清零 Alpha，保留 RGB 便于调试和后续图像处理；量化阶段会依据 Alpha 跳过它。
        pixels[x, y] = (red, green, blue, 0)
        # 四邻域而非八邻域，避免仅对角相接的主体缝隙被背景“斜穿”过去。
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height:
                next_index = next_y * width + next_x
                if not visited[next_index]:
                    queue.append((next_x, next_y))

    return output
