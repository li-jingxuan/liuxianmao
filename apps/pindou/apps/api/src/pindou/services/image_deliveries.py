"""短期保存管理员上传的完整施工图，并按随机 token 提供读取能力。"""

from __future__ import annotations

import os
import re
import secrets
import stat
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TOKEN_GENERATION_ATTEMPTS = 3


class DeliveryImageInvalidError(ValueError):
    """上传内容不是服务允许的完整 PNG 图纸。"""


class DeliveryImageTooLargeError(ValueError):
    """上传内容的压缩体积或解码像素数超过配置上限。"""


class DeliveryStorageError(RuntimeError):
    """交付目录当前无法安全写入。"""


@dataclass(frozen=True, slots=True)
class StoredImageDelivery:
    """交付文件的服务端定位信息，不直接暴露磁盘路径给客户端。"""

    token: str
    path: Path
    expires_at: datetime


class ImageDeliveryStore:
    """封装 PNG 校验、原子写入、过期判断和清理。"""

    def __init__(
        self,
        *,
        directory: Path,
        ttl_seconds: int,
        max_bytes: int,
        max_pixels: int,
    ) -> None:
        self.directory = directory
        self.ttl_seconds = ttl_seconds
        self.max_bytes = max_bytes
        self.max_pixels = max_pixels

    def prepare(self) -> None:
        """启动阶段创建目录，使权限问题在接收请求前暴露。"""
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise DeliveryStorageError("图纸交付目录不可用") from exc

    def create(self, content: bytes, *, now: datetime | None = None) -> StoredImageDelivery:
        """验证并原子保存 PNG，避免异常请求留下可被读取的半文件。"""
        if len(content) > self.max_bytes:
            raise DeliveryImageTooLargeError("图纸文件体积超过限制")
        self._validate_png(content)
        self.prepare()
        created_at = _as_utc(now or datetime.now(UTC))

        for _ in range(TOKEN_GENERATION_ATTEMPTS):
            token = secrets.token_urlsafe(32)
            target = self.directory / f"{token}.png"
            if target.exists():
                continue

            temporary_path: Path | None = None
            try:
                # 临时文件与目标文件位于同一目录，确保 os.replace() 是原子操作。
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=".delivery-",
                    suffix=".tmp",
                    dir=self.directory,
                )
                temporary_path = Path(temporary_name)
                with os.fdopen(descriptor, "wb") as output:
                    output.write(content)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary_path, target)
                # mtime 是无数据库 MVP 的创建时间来源，显式设置后便于稳定计算 TTL。
                os.utime(target, (created_at.timestamp(), created_at.timestamp()))
            except OSError as exc:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)
                target.unlink(missing_ok=True)
                raise DeliveryStorageError("图纸保存失败") from exc

            return StoredImageDelivery(
                token=token,
                path=target,
                expires_at=created_at + timedelta(seconds=self.ttl_seconds),
            )

        raise DeliveryStorageError("无法生成唯一图纸链接")

    def get(
        self,
        token: str,
        *,
        now: datetime | None = None,
    ) -> StoredImageDelivery | None:
        """只返回格式合法、仍存在且尚未过期的普通 PNG 文件。"""
        if TOKEN_PATTERN.fullmatch(token) is None:
            return None
        path = self.directory / f"{token}.png"
        try:
            file_stat = path.lstat()
        except FileNotFoundError:
            return None
        except OSError:
            return None
        if not stat.S_ISREG(file_stat.st_mode) or path.is_symlink():
            return None

        expires_at = datetime.fromtimestamp(file_stat.st_mtime, UTC) + timedelta(
            seconds=self.ttl_seconds
        )
        if _as_utc(now or datetime.now(UTC)) >= expires_at:
            path.unlink(missing_ok=True)
            return None
        return StoredImageDelivery(token=token, path=path, expires_at=expires_at)

    def delete_expired(self, *, now: datetime | None = None) -> int:
        """删除目录中符合交付命名规则的过期普通文件，不跟随符号链接。"""
        self.prepare()
        current_time = _as_utc(now or datetime.now(UTC))
        deleted = 0
        for path in self.directory.iterdir():
            token = path.name.removesuffix(".png")
            if path.suffix != ".png" or TOKEN_PATTERN.fullmatch(token) is None:
                continue
            try:
                file_stat = path.lstat()
                if not stat.S_ISREG(file_stat.st_mode) or path.is_symlink():
                    continue
                expires_at = datetime.fromtimestamp(file_stat.st_mtime, UTC) + timedelta(
                    seconds=self.ttl_seconds
                )
                if current_time >= expires_at:
                    path.unlink(missing_ok=True)
                    deleted += 1
            except FileNotFoundError:
                # GET 与清理任务并发删除属于正常情况。
                continue
            except OSError:
                # 单个文件异常不能阻止其他过期文件被清理。
                continue
        return deleted

    def _validate_png(self, content: bytes) -> None:
        """同时校验签名、Pillow 格式和像素量，拒绝伪造 MIME 的任意文件。"""
        if not content or not content.startswith(PNG_SIGNATURE):
            raise DeliveryImageInvalidError("图纸必须是 PNG")
        try:
            with Image.open(BytesIO(content)) as image:
                width, height = image.size
                if width <= 0 or height <= 0:
                    raise DeliveryImageInvalidError("图纸尺寸无效")
                if width * height > self.max_pixels:
                    raise DeliveryImageTooLargeError("图纸解码像素数超过限制")
                if image.format != "PNG":
                    raise DeliveryImageInvalidError("图纸必须是 PNG")
                image.verify()
        except DeliveryImageInvalidError:
            raise
        except DeliveryImageTooLargeError:
            raise
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
            raise DeliveryImageInvalidError("PNG 图纸内容损坏") from exc


def _as_utc(value: datetime) -> datetime:
    """统一内部时间为带时区 UTC，避免过期比较混用本地时间。"""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
