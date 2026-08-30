"""Ark 上游错误到稳定 API 错误的集中映射。"""

from __future__ import annotations

from pindou.core.errors import ApiError
from pindou.services.seedream_client import SeedreamUpstreamError


def map_ark_error(exc: SeedreamUpstreamError) -> ApiError:
    """将 Ark 错误映射为可安全返回前端的业务异常。"""

    if exc.code == "InputTextSensitiveContentDetected":
        return _mapped(
            exc,
            400,
            "AI_INPUT_REJECTED",
            "图片或处理指令未通过内容安全检查，请更换素材或调整描述",
            "input_safety",
            False,
        )

    if (
        exc.code == "OutputImageSensitiveContentDetected"
        or (exc.code or "").endswith(".PolicyViolation")
    ):
        return _mapped(
            exc,
            422,
            "AI_OUTPUT_REJECTED",
            "AI 生成结果未通过内容安全或版权审核，请更换或调整素材后重试",
            "output_safety",
            False,
        )

    if exc.code == "QuotaExceeded":
        return _mapped(
            exc,
            429,
            "AI_QUOTA_EXCEEDED",
            "AI 服务额度已用尽，请稍后重试或联系管理员",
            "quota",
            False,
        )

    if exc.status_code == 429:
        return _mapped(
            exc,
            429,
            "AI_BUSY",
            "AI 服务繁忙，请稍后重试",
            "rate_limit",
            True,
        )

    if exc.status_code == 504 or exc.code == "TIMEOUT":
        return _mapped(
            exc,
            504,
            "AI_TIMEOUT",
            "AI 处理超时，本次结果未确认，请稍后手动重试",
            "timeout",
            True,
        )

    if exc.code == "NETWORK_ERROR":
        return _mapped(
            exc,
            502,
            "AI_NETWORK_ERROR",
            "AI 网络请求失败，请稍后重试",
            "network",
            True,
        )

    return _mapped(
        exc,
        502,
        "AI_UPSTREAM_ERROR",
        "AI 服务暂时不可用，请稍后重试",
        "upstream",
        True,
    )

def _mapped(
    exc: SeedreamUpstreamError,
    status_code: int,
    code: str,
    message: str,
    category: str,
    retryable: bool,
) -> ApiError:
    return ApiError(
        status_code,
        code,
        message,
        provider="ark",
        provider_code=exc.code,
        retryable=retryable,
        provider_message=exc.message,
        category=category,
    )
