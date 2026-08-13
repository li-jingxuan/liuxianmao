"""定义量化前图片增强器接口及 MVP1 的原样通过实现。"""

from __future__ import annotations

from typing import Protocol

from PIL import Image


class ImageEnhancer(Protocol):
    """量化前可插拔的图片增强能力。

    路由只依赖该协议，不感知 Seedream 或其他供应商。实现可以返回输入对象，也可以
    返回新的 Pillow 图片；调用方负责依据对象身份正确关闭资源。
    """

    @property
    def name(self) -> str: ...

    def enhance(self, image: Image.Image) -> Image.Image: ...


class PassThroughEnhancer:
    """MVP1 默认增强器：不修改图片，也不发起任何外部请求。"""

    @property
    def name(self) -> str:
        return "passthrough"

    def enhance(self, image: Image.Image) -> Image.Image:
        """原样返回输入对象，为后续 AI 增强器保留稳定接口缝隙。"""
        return image
