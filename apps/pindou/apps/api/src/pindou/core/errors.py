"""定义可安全映射到 HTTP 响应的业务异常。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(slots=True)
class ApiError(Exception):
    """可安全暴露给调用方的业务异常。

    `code` 是前端进行稳定错误映射的依据；`message` 是面向用户的中文说明。
    供应商错误、堆栈和文件路径等内部信息不得直接放进这里。
    """

    status_code: int
    code: str
    message: str
    provider_message: str | None = None
    headers: Mapping[str, str] | None = None
    provider: str | None = None
    provider_code: str | None = None
    retryable: bool | None = None
    category: str | None = None

    def __str__(self) -> str:
        return self.message
