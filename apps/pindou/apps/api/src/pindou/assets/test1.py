import base64
from io import BytesIO
from pathlib import Path

from PIL import Image


def prepare_seedream_transparent_input(input_path: str | Path) -> str:
    img = Image.open(input_path).convert("RGBA")

    # 将左上角 1 个像素设置成完全透明
    r, g, b, _ = img.getpixel((0, 0))
    img.putpixel((0, 0), (r, g, b, 0))

    # 保存到内存，不生成临时文件
    buffer = BytesIO()
    img.save(buffer, format="PNG")

    # 转 Base64
    image_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

    return image_base64


path = (
    Path(__file__).parent
    / "images"
    / "xiaozhan.png"
).resolve()

image_base64 = prepare_seedream_transparent_input(path)

print(image_base64)