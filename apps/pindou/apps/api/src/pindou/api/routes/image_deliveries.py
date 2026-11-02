"""管理员上传施工图，以及用户查询、预览和下载施工图的路由。"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, Request, Response, UploadFile, status
from fastapi.responses import FileResponse

from pindou.api.dependencies import AdminApiKeyDep, ImageDeliveryStoreDep
from pindou.core.config import get_settings
from pindou.core.errors import ApiError
from pindou.schemas.image_delivery import ImageDeliveryResponse
from pindou.services.fnos_album import FnosAlbumClient
from pindou.services.image_deliveries import (
    DeliveryImageInvalidError,
    DeliveryImageTooLargeError,
    DeliveryStorageError,
    StoredImageDelivery,
)

router = APIRouter(prefix="/image-deliveries", tags=["image-deliveries"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_image_delivery(
    request: Request,
    response: Response,
    file: Annotated[UploadFile, File()],
    store: ImageDeliveryStoreDep,
    _admin_api_key: AdminApiKeyDep,
) -> ImageDeliveryResponse:
    """保存当前完整施工图；管理鉴权复用固定 KEY_ISSUER_API_KEY。"""
    # 只读取“体积上限 + 1”字节，避免恶意请求把任意大文件完整载入内存。
    content = file.file.read(store.max_bytes + 1)
    if len(content) > store.max_bytes:
        raise ApiError(413, "DELIVERY_IMAGE_TOO_LARGE", "图纸文件超过大小限制")
    try:
        delivery = store.create(content)
    except DeliveryImageTooLargeError as exc:
        raise ApiError(413, "DELIVERY_IMAGE_TOO_LARGE", "图纸尺寸超过限制") from exc
    except DeliveryImageInvalidError as exc:
        raise ApiError(400, "DELIVERY_IMAGE_INVALID", "请上传有效的 PNG 图纸") from exc
    except DeliveryStorageError as exc:
        raise ApiError(507, "DELIVERY_STORAGE_UNAVAILABLE", "图纸存储暂时不可用") from exc

    response.headers["Cache-Control"] = "no-store"
    result = _to_response(delivery)
    settings = get_settings()
    if settings.nas_album_enabled:
        # 同源 POST 的 Origin 只作为可信候选地址的排序提示。
        urls = settings.nas_album_urls_for_origin(request.headers.get("origin"))
        share = FnosAlbumClient(
            base_url=urls[0], fallback_urls=urls[1:], album_id=settings.nas_album_id,
        ).upload_and_share(
            delivery.path,
            ost=request.cookies.get("ost"),
            secret=request.headers.get("X-Fnos-Secret"),
            token=request.headers.get("X-Fnos-Token"),
        )
        result.share_url = share.url
        result.expires_at = share.expires_at
    return result


@router.get("/{token}")
def get_image_delivery_metadata(
    token: str,
    response: Response,
    store: ImageDeliveryStoreDep,
) -> ImageDeliveryResponse:
    """供公开 Web 预览页读取原图地址和服务端计算的准确过期时间。"""
    delivery = _get_or_404(store, token)
    response.headers["Cache-Control"] = "no-store"
    return _to_response(delivery)


@router.get("/{token}/image", response_class=FileResponse)
def view_image_delivery(token: str, store: ImageDeliveryStoreDep) -> FileResponse:
    """以内联 PNG 返回原始图纸，支持移动端预览和长按保存。"""
    return _file_response(_get_or_404(store, token), disposition="inline")


@router.get("/{token}/download", response_class=FileResponse)
def download_image_delivery(token: str, store: ImageDeliveryStoreDep) -> FileResponse:
    """以附件形式返回同一份原始 PNG，供普通浏览器直接下载。"""
    return _file_response(_get_or_404(store, token), disposition="attachment")


def _get_or_404(store: ImageDeliveryStoreDep, token: str) -> StoredImageDelivery:
    """非法、不存在和过期 token 统一为 404，避免泄漏历史状态。"""
    delivery = store.get(token)
    if delivery is None:
        raise ApiError(404, "DELIVERY_IMAGE_NOT_FOUND", "图纸链接不存在或已过期")
    return delivery


def _to_response(delivery: StoredImageDelivery) -> ImageDeliveryResponse:
    """集中构造相对 API 路径，避免从请求 Host 反射外部地址。"""
    base_path = f"/api/v1/image-deliveries/{delivery.token}"
    return ImageDeliveryResponse(
        token=delivery.token,
        image_url=f"{base_path}/image",
        download_url=f"{base_path}/download",
        expires_at=delivery.expires_at,
    )


def _file_response(
    delivery: StoredImageDelivery,
    *,
    disposition: str,
) -> FileResponse:
    """固定响应 MIME、文件名和剩余缓存时间，不反射上传元数据。"""
    remaining_seconds = max(
        0,
        int((delivery.expires_at - datetime.now(UTC)).total_seconds()),
    )
    return FileResponse(
        delivery.path,
        media_type="image/png",
        filename="pindou-pattern.png",
        content_disposition_type=disposition,
        headers={
            "Cache-Control": f"private, max-age={remaining_seconds}",
            "X-Content-Type-Options": "nosniff",
        },
    )
