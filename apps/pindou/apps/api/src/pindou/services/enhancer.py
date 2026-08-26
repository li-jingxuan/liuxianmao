"""定义量化前图片增强器接口及 MVP1 的原样通过实现。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from PIL import Image

from pindou.imaging.color_budget import ColorBudgetBand
from pindou.schemas.conversion import BackgroundMode


@dataclass(frozen=True, slots=True)
class EnhancementOptions:
    """增强器所需的业务上下文，避免在供应商实现中依赖 HTTP 表单。"""

    grid_size: int
    color_budget_band: ColorBudgetBand
    background_mode: BackgroundMode
    background_color: str | None = None
    # Solid 模式内部使用的抠图键色。它与用户最终看到的背景色完全独立，只能由
    # 前景准备模块选择并传给增强器，HTTP 路由和前端都不应允许用户直接指定。
    chroma_key: str | None = None


@dataclass(frozen=True, slots=True)
class EnhancementResult:
    """增强器输出图片。

    Alpha 或键色是否足以构成可信前景，不应由供应商适配器自行宣称。统一交给
    `prepare_foreground()` 检查，避免“存在一个透明像素就算透明图”的宽松判断。
    """

    image: Image.Image


class ImageEnhancer(Protocol):
    """量化前可插拔的图片增强能力。

    路由只依赖该协议，不感知 Seedream 或其他供应商。实现可以返回输入对象，也可以
    返回新的 Pillow 图片；调用方负责依据对象身份正确关闭资源。
    """

    @property
    def name(self) -> str: ...

    @property
    def model(self) -> str | None: ...

    @property
    def prompt_version(self) -> str | None: ...

    def enhance(
        self,
        image: Image.Image,
        *,
        options: EnhancementOptions,
    ) -> EnhancementResult: ...


class PassThroughEnhancer:
    """MVP1 默认增强器：不修改图片，也不发起任何外部请求。"""

    @property
    def name(self) -> str:
        return "passthrough"

    @property
    def model(self) -> None:
        return None

    @property
    def prompt_version(self) -> None:
        return None

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        """原样返回输入对象；是否具备可信前景蒙版由调用方统一验证。"""
        del options
        return EnhancementResult(image=image)
