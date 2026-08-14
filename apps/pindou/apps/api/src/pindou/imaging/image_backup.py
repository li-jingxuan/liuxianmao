"""持久化 AI 增强前后的图片，便于人工比对与问题排查。"""

from __future__ import annotations

import time
from pathlib import Path

from PIL import Image


def backup_enhanced_images(
    original: Image.Image,
    enhanced: Image.Image,
    *,
    directory: Path,
) -> tuple[Path, Path]:
    """以同一毫秒时间戳保存一对 PNG，并在并发冲突时递增时间戳。"""
    directory.mkdir(parents=True, exist_ok=True)
    timestamp_ms = time.time_ns() // 1_000_000

    while True:
        original_path = directory / f"{timestamp_ms}-original.png"
        enhanced_path = directory / f"{timestamp_ms}-enhanced.png"
        try:
            original_file = original_path.open("xb")
        except FileExistsError:
            timestamp_ms += 1
            continue

        try:
            # xb 可防止同一毫秒内的并发请求覆盖已有备份。
            with original_file, enhanced_path.open("xb") as enhanced_file:
                original.save(original_file, format="PNG")
                enhanced.save(enhanced_file, format="PNG")
        except FileExistsError:
            original_file.close()
            original_path.unlink(missing_ok=True)
            timestamp_ms += 1
            continue
        except Exception:
            original_file.close()
            original_path.unlink(missing_ok=True)
            enhanced_path.unlink(missing_ok=True)
            raise

        return original_path, enhanced_path
