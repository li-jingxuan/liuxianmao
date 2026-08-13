"""FastAPI 应用入口、生命周期、请求追踪和全局异常映射。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pindou.api.dependencies import get_color_chart, get_image_enhancer
from pindou.api.routes.color_sets import router as color_sets_router
from pindou.api.routes.conversions import router as conversions_router
from pindou.core.errors import ApiError
from pindou.schemas.conversion import HealthResponse


@asynccontextmanager
async def lifespan(_: FastAPI):
    """在开始接收请求前预加载关键只读依赖。

    色卡损坏或增强器配置错误会在启动阶段暴露，避免服务看似健康却在首个转换请求
    时失败。缓存对象在进程生命周期内只读复用，无需关闭外部连接。
    """
    get_color_chart()
    enhancer = get_image_enhancer()
    try:
        yield
    finally:
        # SeedreamEnhancer 持有 HTTP 连接池；passthrough 没有 close，安全跳过。
        close = getattr(enhancer, "close", None)
        if callable(close):
            close()


app = FastAPI(title="Pindou API", version="0.1.0", lifespan=lifespan)

# 当前 API 使用 Bearer/表单请求且不依赖跨域 Cookie，因此可以安全地返回通配
# Access-Control-Allow-Origin。若未来引入 Cookie 会话，必须改成明确的可信域名列表。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-request-id"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """为每个请求添加可贯穿前后端日志的 request ID。

    调用方可以传入 `x-request-id` 方便链路追踪；缺失时服务生成随机 ID。响应头和
    业务错误体都会回传同一个值。
    """
    request.state.request_id = request.headers.get("x-request-id") or f"req_{uuid4().hex}"
    response = await call_next(request)
    response.headers["x-request-id"] = request.state.request_id
    return response


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
    """把领域业务异常映射为稳定、无内部敏感信息的 JSON 结构。"""
    return JSONResponse(
        status_code=exc.status_code,
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


# 所有业务接口统一使用 /api/v1；健康检查保留在根路径便于基础设施调用。
app.include_router(color_sets_router, prefix="/api/v1")
app.include_router(conversions_router, prefix="/api/v1")
