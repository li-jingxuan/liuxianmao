"""FastAPI 应用入口、生命周期、请求追踪和全局异常映射。"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from pindou.api.dependencies import (
    SessionDep,
    get_color_chart,
    get_image_delivery_store,
    get_image_enhancer,
)
from pindou.api.routes.access_keys import router as access_keys_router
from pindou.api.routes.color_sets import router as color_sets_router
from pindou.api.routes.colors import router as colors_router
from pindou.api.routes.conversions import router as conversions_router
from pindou.api.routes.image_deliveries import router as image_deliveries_router
from pindou.core.config import get_settings
from pindou.core.errors import ApiError
from pindou.db.session import check_database, dispose_engine, get_engine
from pindou.schemas.conversion import HealthResponse

logger = logging.getLogger(__name__)


async def cleanup_expired_image_deliveries() -> None:
    """低频清理过期交付图；单次磁盘扫描放在线程中避免阻塞事件循环。"""
    settings = get_settings()
    store = get_image_delivery_store()
    while True:
        await asyncio.sleep(settings.image_delivery_cleanup_interval_seconds)
        try:
            deleted = await asyncio.to_thread(store.delete_expired)
            if deleted:
                logger.info("清理过期交付图: deleted=%s", deleted)
        except Exception:
            # 周期任务失败不能终止 API；下一周期继续重试并保留异常堆栈。
            logger.exception("清理过期交付图失败")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """在开始接收请求前预加载关键只读依赖。

    色卡损坏或增强器配置错误会在启动阶段暴露，避免服务看似健康却在首个转换请求
    时失败。缓存对象在进程生命周期内只读复用，无需关闭外部连接。
    """
    get_color_chart()
    get_engine()
    enhancer = get_image_enhancer()
    delivery_store = get_image_delivery_store()
    delivery_store.prepare()
    delivery_store.delete_expired()
    delivery_cleanup_task = asyncio.create_task(cleanup_expired_image_deliveries())
    try:
        yield
    finally:
        delivery_cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await delivery_cleanup_task
        # SeedreamEnhancer 持有 HTTP 连接池；passthrough 没有 close，安全跳过。
        close = getattr(enhancer, "close", None)
        if callable(close):
            close()
        dispose_engine()


app = FastAPI(title="Pindou API", version="0.1.0", lifespan=lifespan)

# 当前 API 使用 Bearer/表单请求且不依赖跨域 Cookie，因此可以安全地返回通配
# Access-Control-Allow-Origin。若未来引入 Cookie 会话，必须改成明确的可信域名列表。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-request-id", "x-ratelimit-limit", "x-ratelimit-remaining"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """为每个请求添加可贯穿前后端日志的 request ID。

    调用方可以传入 `x-request-id` 方便链路追踪；缺失时服务生成随机 ID。响应头和
    业务错误体都会回传同一个值。
    """
    supplied_request_id = request.headers.get("x-request-id")
    request.state.request_id = (
        supplied_request_id
        if supplied_request_id and len(supplied_request_id) <= 128
        else f"req_{uuid4().hex}"
    )
    response = await call_next(request)
    response.headers["x-request-id"] = request.state.request_id
    return response


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
    """把领域业务异常映射为稳定、无内部敏感信息的 JSON 结构。"""
    return JSONResponse(
        status_code=exc.status_code,
        headers=exc.headers,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "request_id": request.state.request_id,
            }
        },
    )


@app.get("/healthz")
def healthcheck() -> HealthResponse:
    """供容器或反向代理探活；不执行昂贵的图片处理。"""
    return HealthResponse()


@app.get("/readyz")
def readiness_check(session: SessionDep) -> HealthResponse:
    """确认数据库可连接，供编排系统判断实例是否可以接收流量。"""
    try:
        check_database(session)
    except SQLAlchemyError as exc:
        raise ApiError(503, "DATABASE_UNAVAILABLE", "数据库暂时不可用，请稍后重试") from exc
    return HealthResponse()


# 所有业务接口统一使用 /api/v1；健康检查保留在根路径便于基础设施调用。
app.include_router(color_sets_router, prefix="/api/v1")
app.include_router(colors_router, prefix="/api/v1")
app.include_router(access_keys_router, prefix="/api/v1")
app.include_router(conversions_router, prefix="/api/v1")
app.include_router(image_deliveries_router, prefix="/api/v1")
