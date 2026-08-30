"""Seedream 透明背景图生图的确定性输入预处理。"""

from __future__ import annotations

from PIL import Image, ImageOps


def prepare_transparent_input(image: Image.Image, *, max_edge: int | None = None) -> Image.Image:
    """返回可供 `background=transparent` 使用的独立 RGBA PNG 源图。

    只将左上角一个像素变为完全透明，以满足上游对 Alpha 输入的要求；这不是
    本地抠图，也不对其余像素作任何背景语义判断。
    """
    oriented = ImageOps.exif_transpose(image)
    try:
        prepared = oriented.convert("RGBA")
    finally:
        if oriented is not image:
            oriented.close()

    if max_edge is not None:
        prepared.thumbnail((max_edge, max_edge), resample=Image.Resampling.LANCZOS)
    prepared.putpixel((0, 0), (0, 0, 0, 0))
    return prepared
