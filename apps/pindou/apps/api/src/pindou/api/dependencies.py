"""FastAPI 公共依赖的构造和缓存策略。"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Annotated

import httpx
from fastapi import Depends, Header
from sqlmodel import Session

from pindou.color.chart import MardColorChart, load_mard_color_chart
from pindou.core.config import Settings, get_settings
from pindou.core.errors import ApiError
from pindou.db.session import get_session
from pindou.services.access_keys import AccessKeyService
from pindou.services.enhancer import ImageEnhancer, PassThroughEnhancer
from pindou.services.image_deliveries import ImageDeliveryStore
from pindou.services.seedream_client import SeedreamClient
from pindou.services.seedream_enhancer import SeedreamEnhancer


def provide_settings() -> Settings:
    """向路由提供全局只读配置。"""
    return get_settings()


def provide_access_key_service(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(provide_settings)],
) -> AccessKeyService:
    """用请求级 Session 和服务端 pepper 构造密钥领域服务。"""
    configured_pepper = settings.api_key_hash_pepper
    if configured_pepper is None:
        raise RuntimeError("API_KEY_HASH_PEPPER is required")
    return AccessKeyService(
        session,
        hash_pepper=configured_pepper.get_secret_value(),
    )


def require_admin_api_key(
    settings: Annotated[Settings, Depends(provide_settings)],
    supplied_key: Annotated[str | None, Header(alias="X-Admin-API-Key")] = None,
) -> None:
    """以常量时间比较固定签发管理密钥。"""
    configured_key = settings.key_issuer_api_key
    expected = configured_key.get_secret_value() if configured_key is not None else ""
    if not supplied_key or not expected or not secrets.compare_digest(supplied_key, expected):
        raise ApiError(
            401,
            "ADMIN_API_KEY_INVALID",
            "签发管理密钥无效",
            headers={"WWW-Authenticate": "ApiKey"},
        )


@lru_cache
def get_color_chart() -> MardColorChart:
    """加载并缓存经过完整校验的 MARD 色卡。

    色卡包含数百条颜色和 11 个颜色套装，没有必要在每个请求中重复读取 JSON。
    启动生命周期会主动调用此函数，因此色卡损坏时服务会启动失败，而不是等到
    第一位用户上传图片后才暴露配置问题。
    """
    return load_mard_color_chart(get_settings().color_chart_path)


@lru_cache
def get_image_enhancer() -> ImageEnhancer:
    """根据配置构造 passthrough 或 Seedream 图片增强器。"""
    app_settings = get_settings()
    if app_settings.image_enhancer == "passthrough":
        return PassThroughEnhancer()

    api_key = app_settings.ark_doubao_api_key
    if api_key is None:  # Settings 已验证，此分支只是类型安全兜底。
        raise RuntimeError("ARK_DOUBAO_API_KEY is required")
    timeout = httpx.Timeout(
        connect=app_settings.ark_doubao_connect_timeout_seconds,
        read=app_settings.ark_doubao_read_timeout_seconds,
        write=app_settings.ark_doubao_write_timeout_seconds,
        pool=app_settings.ark_doubao_pool_timeout_seconds,
    )
    client = SeedreamClient(
        api_key=api_key.get_secret_value(),
        base_url=app_settings.ark_doubao_base_url,
        model=app_settings.ark_doubao_image_model,
        image_size=app_settings.ark_doubao_image_size,
        watermark=app_settings.ark_doubao_watermark,
        max_response_bytes=app_settings.ark_doubao_max_response_bytes,
        timeout=timeout,
    )
    return SeedreamEnhancer(
        client=client,
        model=app_settings.ark_doubao_image_model,
        prompt_version=app_settings.seedream_prompt_version,
        input_max_edge=app_settings.seedream_input_max_edge,
        output_max_pixels=app_settings.seedream_output_max_pixels,
        max_concurrency=app_settings.ark_doubao_max_concurrency,
        queue_timeout_seconds=app_settings.ark_doubao_queue_timeout_seconds,
    )


@lru_cache
def get_image_delivery_store() -> ImageDeliveryStore:
    """按进程复用无状态的交付文件存储配置。"""
    app_settings = get_settings()
    return ImageDeliveryStore(
        directory=app_settings.image_delivery_dir,
        ttl_seconds=app_settings.image_delivery_ttl_seconds,
        max_bytes=app_settings.image_delivery_max_bytes,
        max_pixels=app_settings.image_delivery_max_pixels,
    )


def provide_image_delivery_store() -> ImageDeliveryStore:
    """向交付路由提供与 lifespan 相同的存储实例。"""
    return get_image_delivery_store()


# 使用 `Annotated + Depends` 定义可复用的依赖类型，使路由签名保持简洁且类型明确。
SettingsDep = Annotated[Settings, Depends(provide_settings)]
ColorChartDep = Annotated[MardColorChart, Depends(get_color_chart)]
ImageEnhancerDep = Annotated[ImageEnhancer, Depends(get_image_enhancer)]
SessionDep = Annotated[Session, Depends(get_session)]
AccessKeyServiceDep = Annotated[AccessKeyService, Depends(provide_access_key_service)]
AdminApiKeyDep = Annotated[None, Depends(require_admin_api_key)]
ImageDeliveryStoreDep = Annotated[ImageDeliveryStore, Depends(provide_image_delivery_store)]
