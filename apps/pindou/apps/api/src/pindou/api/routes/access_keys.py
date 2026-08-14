"""受管理密钥保护的消费密钥签发接口。"""

from __future__ import annotations

from fastapi import APIRouter, status

from pindou.api.dependencies import AccessKeyServiceDep, AdminApiKeyDep
from pindou.schemas.access_key import AccessKeyCreateRequest, AccessKeyCreateResponse

router = APIRouter(prefix="/access-keys", tags=["access-keys"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_access_key(
    payload: AccessKeyCreateRequest,
    service: AccessKeyServiceDep,
    _admin_api_key: AdminApiKeyDep,
) -> AccessKeyCreateResponse:
    """按已登记来源签发指定使用次数的唯一消费密钥。"""
    issued = service.issue(
        prefix_code=payload.prefix,
        allowed_uses=payload.allowed_uses,
    )
    return AccessKeyCreateResponse(
        key=issued.key,
        prefix=issued.prefix,
        allowed_uses=issued.allowed_uses,
        remaining_uses=issued.remaining_uses,
        created_at=issued.created_at,
    )

