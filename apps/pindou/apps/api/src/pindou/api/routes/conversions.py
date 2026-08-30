"""图片上传、参数校验和拼豆网格转换路由。"""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, Request, Response, UploadFile

from pindou.api.dependencies import (
    AccessKeyServiceDep,
    ColorChartDep,
    ForegroundPreparerDep,
    SettingsDep,
)
from pindou.core.errors import ApiError
from pindou.core.event_log import write_event_log
from pindou.imaging.color_budget import resolve_color_budget
from pindou.imaging.grid import build_bead_grid
from pindou.imaging.image_backup import backup_ai_processing_images
from pindou.imaging.preprocess import decode_image
from pindou.schemas.conversion import (
    BackgroundMode,
    ConversionMeta,
    ConversionResponse,
    ConversionStats,
    ConversionStyle,
    ForegroundFallbackMode,
    ForegroundGrid,
    PaletteColor,
    RenderBackground,
)
from pindou.services.enhancer import EnhancementOptions
from pindou.services.seedream_prompt import normalize_background_color

router = APIRouter(prefix="/conversions", tags=["conversions"])
logger = logging.getLogger(__name__)

_DEGRADE_DIAGNOSTIC_KEYS = frozenset(
    {
        "validation_failures",
        "chroma_policy_version",
        "requested_key",
        "actual_key",
        "requested_key_delta_e76",
        "max_requested_key_delta_e76",
        "border_coverage",
        "min_border_coverage",
        "edge_count",
        "min_edge_count",
        "background_coverage",
        "min_background_coverage",
        "max_background_coverage",
        "transition_coverage",
        "max_transition_coverage",
        "fallback_mask",
        "foreground_validation_failures",
        "foreground_coverage",
        "min_foreground_coverage",
        "max_foreground_coverage",
        "foreground_background_coverage",
        "min_foreground_background_coverage",
        "foreground_uncertain_coverage",
        "max_foreground_uncertain_coverage",
        "foreground_policy_version",
    }
)


@router.post("")
def create_conversion(
    request: Request,
    response: Response,
    image: Annotated[UploadFile, File()],
    grid_size: Annotated[int, Form()],
    color_set_size: Annotated[int, Form()],
    conversion_style: Annotated[ConversionStyle, Form()],
    max_colors: Annotated[int | None, Form()] = None,
    background_mode: Annotated[BackgroundMode, Form()] = BackgroundMode.SOLID,
    background_color: Annotated[str | None, Form()] = None,
    fallback_mode: Annotated[ForegroundFallbackMode, Form()] = ForegroundFallbackMode.NONE,
    *,
    chart: ColorChartDep,
    foreground_preparer: ForegroundPreparerDep,
    app_settings: SettingsDep,
    access_keys: AccessKeyServiceDep,
    api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> ConversionResponse:
    """把上传图片转换为受指定 MARD 颜色组约束的方形拼豆网格。

    此端点使用普通同步函数：Pillow 解码和颜色量化都是阻塞型 CPU 工作，FastAPI
    会把同步路由放在线程池执行。AI 模式会备份增强前后的图片，但响应仍只包含前端
    Canvas 渲染所需的调色板和位置矩阵。
    """
    # 第一层先验证低成本的表单参数，避免非法请求进入图片解码和量化阶段。
    if not app_settings.min_grid_size <= grid_size <= app_settings.max_grid_size:
        raise ApiError(
            400,
            "GRID_SIZE_INVALID",
            f"网格尺寸必须在 {app_settings.min_grid_size} 到 {app_settings.max_grid_size} 之间",
        )
    if max_colors is not None and not 8 <= max_colors <= 54:
        raise ApiError(400, "MAX_COLORS_INVALID", "最大颜色数必须在 8 到 54 之间")
    if chart.get_set(color_set_size) is None:
        raise ApiError(400, "COLOR_SET_INVALID", "请选择有效的 MARD 颜色组")
    color_budget = resolve_color_budget(
        grid_size=grid_size,
        color_set_size=color_set_size,
        legacy_max_colors=max_colors,
    )
    normalized_background_color = (
        normalize_background_color(background_color)
        if background_mode is BackgroundMode.SOLID
        else None
    )
    if conversion_style not in foreground_preparer.supported_styles:
        logger.warning(
            "Image conversion style unavailable",
            extra={
                "conversion_style": conversion_style.value,
                "enhancer": foreground_preparer.enhancer_name,
                "background_mode": background_mode.value,
                "grid_size": grid_size,
                "error_code": "CONVERSION_STYLE_UNAVAILABLE",
            },
        )
        raise ApiError(
            503,
            "CONVERSION_STYLE_UNAVAILABLE",
            "当前转换类型暂不可用，请选择原图增强后重试",
        )

    # 只读取“上限 + 1”字节即可判断超限，避免把任意大文件完整读入内存。
    content = image.file.read(app_settings.upload_max_bytes + 1)
    if len(content) > app_settings.upload_max_bytes:
        raise ApiError(413, "IMAGE_TOO_LARGE", "图片文件超过 10 MiB 限制")
    if not content:
        raise ApiError(400, "IMAGE_DECODE_FAILED", "图片内容为空")

    # 解码阶段会验证真实图片格式、应用 EXIF 方向并统一转换为 RGBA。
    decoded = decode_image(content, max_pixels=app_settings.upload_max_pixels)
    try:
        access_keys.assert_available(api_key)
    except Exception:
        decoded.close()
        raise
    enhanced = decoded
    enhancer_image = None
    # ForegroundPreparer 是背景能力的唯一 seam；路由不感知模型 tensor 或蒙版阈值。
    background_processing = "none"
    try:
        # 仅在所有低成本参数和图片校验通过后扣次；条件更新已提交后不因后续
        # AI/量化错误退款，避免并发补偿造成超额使用。
        enhancement_started = perf_counter()
        try:
            prepared = foreground_preparer.prepare(
                decoded,
                options=EnhancementOptions(
                    grid_size=grid_size,
                    color_budget_band=color_budget.prompt_band,
                    background_mode=background_mode,
                    conversion_style=conversion_style,
                    background_color=normalized_background_color,
                ),
                fallback_mode=fallback_mode,
            )
        except ApiError as exc:
            logger.warning(
                "Image enhancement failed",
                extra={
                    "conversion_style": conversion_style.value,
                    "enhancer": foreground_preparer.enhancer_name,
                    "background_mode": background_mode.value,
                    "grid_size": grid_size,
                    "ai_duration_ms": (perf_counter() - enhancement_started) * 1_000,
                    "error_code": exc.code,
                },
            )
            if exc.code == "AI_UPSTREAM_ERROR":
                try:
                    write_event_log(
                        "ai_upstream_error",
                        {
                            "request_id": request.state.request_id,
                            "error_code": exc.code,
                            "status_code": exc.status_code,
                            "conversion_style": conversion_style.value,
                            "background_mode": background_mode.value,
                            "grid_size": grid_size,
                            "message": exc.message,
                            "enhancer": foreground_preparer.enhancer_name,
                            "ai_duration_ms": (perf_counter() - enhancement_started) * 1_000,
                        },
                        directory=app_settings.event_log_dir,
                    )
                except Exception:
                    # 诊断日志不可用时仍保持原有 502 错误契约。
                    logger.exception(
                        "Failed to persist AI upstream error event",
                        extra={"request_id": request.state.request_id},
                    )
            raise
        ai_duration_ms = (perf_counter() - enhancement_started) * 1_000
        enhanced = prepared.image
        enhancer_image = prepared.enhancer_image
        background_processing = prepared.processing
        if prepared.degraded:
            # 通用落盘模块不感知业务字段；路由在边界上显式白名单化，
            # 避免未来 diagnostics 加入敏感对象后被无意写入文件。
            degrade_diagnostics = {
                key: value
                for key, value in (prepared.diagnostics or {}).items()
                if key in _DEGRADE_DIAGNOSTIC_KEYS
            }
            try:
                write_event_log(
                    "foreground_degraded",
                    {
                        "request_id": request.state.request_id,
                        "processing": prepared.processing,
                        "degrade_reason": prepared.degrade_reason,
                        "enhancer": prepared.enhancer_name,
                        "enhancer_model": prepared.enhancer_model,
                        "enhancer_prompt_version": prepared.enhancer_prompt_version,
                        "foreground_model_version": prepared.foreground_model_version,
                        "background_mode": background_mode.value,
                        "grid_size": grid_size,
                        "ai_duration_ms": ai_duration_ms,
                        **degrade_diagnostics,
                    },
                    directory=app_settings.event_log_dir,
                )
            except Exception:
                # 诊断日志不是转换产物；落盘故障可观测但不能将成功转换变为 5xx。
                logger.exception(
                    "Failed to persist foreground degradation event",
                    extra={"request_id": request.state.request_id},
                )
        # 分别保存 Seedream 原始增强结果与 ONNX 最终输入，避免阶段语义混淆。
        if prepared.enhancer_name != "passthrough":
            backup_ai_processing_images(
                decoded,
                enhancer_image if enhancer_image is not None else enhanced,
                # ONNX 关闭时最终前景只存在请求内存中，不落盘；Seedream 原始输出
                # 仍由 enhancer_image 单独备份，避免把降级透明结果误标为 ONNX 阶段。
                foreground_final=(
                    enhanced if prepared.processing in {"hybrid_matte", "local_matte"} else None
                ),
                metrics={
                    "enhancer": prepared.enhancer_name,
                    "enhancer_model": prepared.enhancer_model,
                    "enhancer_prompt_version": prepared.enhancer_prompt_version,
                    "background_processing": prepared.processing,
                    "foreground_model_version": prepared.foreground_model_version,
                    "degraded": prepared.degraded,
                    "degrade_reason": prepared.degrade_reason,
                    "ai_duration_ms": ai_duration_ms,
                    **(prepared.diagnostics or {}),
                },
                directory=app_settings.image_backup_dir,
            )
        # 此处只能传入已经完成背景分离的 enhanced；build_bead_grid 内部只负责方形适配
        # 和量化，不再猜测 AI 背景语义，保证职责边界清晰。
        grid = build_bead_grid(
            enhanced,
            chart=chart,
            grid_size=grid_size,
            effective_max_colors=color_budget.effective_max_colors,
            color_set_size=color_set_size,
            background_mode=prepared.applied_background_mode,
            background_color=(
                normalized_background_color
                if prepared.applied_background_mode is BackgroundMode.SOLID
                else None
            ),
        )
        logger.info(
            "Image conversion completed",
            extra={
                "conversion_style": conversion_style.value,
                "enhancer": prepared.enhancer_name,
                "enhancer_prompt_version": prepared.enhancer_prompt_version,
                "background_mode": background_mode.value,
                "grid_size": grid_size,
                "ai_duration_ms": ai_duration_ms,
                "error_code": None,
            },
        )
    finally:
        # 按对象身份去重关闭原图、增强中间图和最终图，兼容 passthrough 返回原对象。
        closed_image_ids: set[int] = set()
        for owned_image in (enhanced, enhancer_image, decoded):
            if owned_image is not None and id(owned_image) not in closed_image_ids:
                owned_image.close()
                closed_image_ids.add(id(owned_image))

    # 在 HTTP 边界把内部不可变 tuple 模型转换为 JSON 友好的 list/Pydantic 模型。
    # Solid 背景是渲染层，不进入前景 palette；keep/simplify 不额外铺设背景层。
    render_background = (
        RenderBackground(mode="solid", color=normalized_background_color)
        if prepared.applied_background_mode is BackgroundMode.SOLID
        else RenderBackground(mode="none")
    )
    conversion_response = ConversionResponse(
        algorithm_version=grid.algorithm_version,
        width=grid.width,
        height=grid.height,
        foreground=ForegroundGrid(
            palette=[
                PaletteColor(
                    id=index,
                    code=color.code,
                    hex=color.hex,
                    rgb=color.rgb,
                )
                for index, color in enumerate(grid.palette)
            ],
            rows=[list(row) for row in grid.rows],
        ),
        background=render_background,
        meta=ConversionMeta(
            # 回传约束与色卡版本，便于前端展示和未来复现结果。
            enhancer=prepared.enhancer_name,
            enhancer_model=prepared.enhancer_model,
            enhancer_prompt_version=prepared.enhancer_prompt_version,
            conversion_style=conversion_style,
            background_mode=background_mode,
            applied_background_mode=prepared.applied_background_mode,
            background_color=normalized_background_color,
            background_processing=background_processing,
            foreground_model_version=prepared.foreground_model_version,
            degraded=prepared.degraded,
            degrade_reason=prepared.degrade_reason,
            color_set_size=color_set_size,
            color_budget_mode=color_budget.mode,
            color_budget_policy_version=color_budget.policy_version,
            effective_max_colors=grid.effective_max_colors,
            color_chart_version=chart.schema_version,
            actual_color_count=grid.color_count,
        ),
        stats=ConversionStats(bead_count=grid.bead_count, color_count=grid.color_count),
    )
    quota = access_keys.consume(api_key, request_id=request.state.request_id)
    response.headers["X-RateLimit-Limit"] = str(quota.initial_uses)
    response.headers["X-RateLimit-Remaining"] = str(quota.remaining_uses)
    return conversion_response
