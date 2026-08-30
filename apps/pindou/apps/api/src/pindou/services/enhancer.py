"""定义量化前图片增强器接口及 MVP1 的原样通过实现。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from PIL import Image

from pindou.core.errors import ApiError
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.schemas.conversion import BackgroundMode, ConversionStyle

ORIGINAL_ONLY = frozenset({ConversionStyle.ORIGINAL})


@dataclass(frozen=True, slots=True)
class EnhancementOptions:
    """增强器所需的业务上下文，避免在供应商实现中依赖 HTTP 表单。"""

    grid_size: int
    color_budget_band: ColorBudgetBand
    background_mode: BackgroundMode
    conversion_style: ConversionStyle
    background_color: str | None = None
    # 仅由前景准备 module 派生，不接受 HTTP 表单直接控制。
    background_hint_kind: Literal["none", "chroma_key"] = "none"


@dataclass(frozen=True, slots=True)
class BackgroundHint:
    """增强器请求过的内部背景提示；调用方必须验证图片后才能使用。"""

    kind: Literal["chroma_key"]
    requested_color: tuple[int, int, int]
    policy_version: str


@dataclass(frozen=True, slots=True)
class NativeAlphaHint:
    """上游 PNG 确实携带原生透明信息，但 Alpha 质量仍待统一验证。"""

    kind: Literal["native_alpha"] = "native_alpha"
    container_format: Literal["PNG"] = "PNG"


@dataclass(frozen=True, slots=True)
class EnhancementResult:
    """增强器输出图片。

    Alpha 或键色是否足以构成可信前景，不应由供应商适配器自行宣称。统一交给
    Solid 输出的主体蒙版由 `ForegroundPreparer` 统一生成和验证。
    """

    image: Image.Image
    background_hint: BackgroundHint | NativeAlphaHint | None = None
    model: str | None = None


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

    @property
    def supported_styles(self) -> frozenset[ConversionStyle]: ...

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

    @property
    def supported_styles(self) -> frozenset[ConversionStyle]:
        return ORIGINAL_ONLY

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        """原样返回输入对象；是否具备可信前景蒙版由调用方统一验证。"""
        if options.conversion_style not in self.supported_styles:
            raise ApiError(
                503,
                "CONVERSION_STYLE_UNAVAILABLE",
                "当前转换类型暂不可用，请选择原图增强后重试",
            )
        return EnhancementResult(image=image)
