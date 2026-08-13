"""FastAPI 公共依赖的构造和缓存策略。"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from pindou.color.chart import MardColorChart, load_mard_color_chart
from pindou.core.config import Settings, settings
from pindou.services.enhancer import ImageEnhancer, PassThroughEnhancer


def get_settings() -> Settings:
    """向路由提供全局只读配置。"""
    return settings


@lru_cache
def get_color_chart() -> MardColorChart:
    """加载并缓存经过完整校验的 MARD 色卡。

    色卡包含数百条颜色和 11 个累计颜色组，没有必要在每个请求中重复读取 JSON。
    启动生命周期会主动调用此函数，因此色卡损坏时服务会启动失败，而不是等到
    第一位用户上传图片后才暴露配置问题。
    """
    return load_mard_color_chart(settings.color_chart_path)


@lru_cache
def get_image_enhancer() -> ImageEnhancer:
    """根据配置构造图片增强器。

    MVP1 只允许 passthrough，明确拒绝未知值可以避免配置写错时静默跳过增强。
    未来接入 Seedream 时只需在此增加实现选择，转换路由和量化器无需感知供应商。
    """
    if settings.image_enhancer != "passthrough":
        raise RuntimeError(f"unsupported IMAGE_ENHANCER: {settings.image_enhancer}")
    return PassThroughEnhancer()


# 使用 `Annotated + Depends` 定义可复用的依赖类型，使路由签名保持简洁且类型明确。
SettingsDep = Annotated[Settings, Depends(get_settings)]
ColorChartDep = Annotated[MardColorChart, Depends(get_color_chart)]
ImageEnhancerDep = Annotated[ImageEnhancer, Depends(get_image_enhancer)]
