"""管理员图纸交付接口的公开响应契约。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ImageDeliveryResponse(BaseModel):
    """公开预览页恢复图片地址和过期时间所需的最小信息。"""

    token: str
    image_url: str
    download_url: str
    expires_at: datetime
