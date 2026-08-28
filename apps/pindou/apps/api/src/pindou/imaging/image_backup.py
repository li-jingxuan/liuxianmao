"""持久化 AI 各处理阶段的图片，便于人工比对与问题排查。"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from pathlib import Path

from PIL import Image

type JSONScalar = str | int | float | bool | None
type JSONMetricValue = JSONScalar | list[str]

_METRIC_KEYS = frozenset(
    {
        "enhancer",
        "enhancer_model",
        "enhancer_prompt_version",
        "background_processing",
        "foreground_model_version",
        "foreground_validation_failures",
        "foreground_coverage",
        "min_foreground_coverage",
        "max_foreground_coverage",
        "foreground_background_coverage",
        "min_foreground_background_coverage",
        "foreground_uncertain_coverage",
        "max_foreground_uncertain_coverage",
        "foreground_policy_version",
        "degraded",
        "degrade_reason",
        "ai_duration_ms",
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
        "validation_failures",
        "fallback_mask",
        "foreground_disagreement",
        "background_disagreement",
        "transition_expansion",
        "unexpected_non_key_components",
        "unexpected_non_key_coverage",
    }
)


def backup_ai_processing_images(
    original: Image.Image,
    seedream_enhanced: Image.Image,
    *,
    foreground_final: Image.Image | None,
    metrics: Mapping[str, JSONMetricValue] | None = None,
    directory: Path,
) -> tuple[Path, ...]:
    """用同一时间戳保存完整阶段图组，冲突时整组重试，失败时整组回滚。"""
    directory.mkdir(parents=True, exist_ok=True)
    timestamp_ms = time.time_ns() // 1_000_000

    while True:
        images: list[tuple[Path, Image.Image]] = [
            (directory / f"{timestamp_ms}-original.png", original),
            (directory / f"{timestamp_ms}-seedream-enhanced.png", seedream_enhanced),
        ]
        if foreground_final is not None:
            images.append((directory / f"{timestamp_ms}-foreground-final.png", foreground_final))
        safe_metrics: dict[str, JSONMetricValue] = {}
        for key, value in (metrics or {}).items():
            if key not in _METRIC_KEYS:
                continue
            if isinstance(value, (str, int, float, bool, type(None))):
                safe_metrics[key] = value
            elif isinstance(value, list) and all(isinstance(item, str) for item in value):
                # 目前唯一的集合指标是稳定降级原因码列表，禁止任意嵌套对象混入备份。
                safe_metrics[key] = value
        metrics_path = directory / f"{timestamp_ms}-foreground-metrics.json"
        metrics_bytes = json.dumps(
            safe_metrics,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")

        opened_files = []
        created_paths: list[Path] = []
        try:
            # 先独占创建整组文件，确保冲突发生时尚未写入任何图片内容。
            for path, _image in images:
                opened_files.append(path.open("xb"))
                created_paths.append(path)
            opened_files.append(metrics_path.open("xb"))
            created_paths.append(metrics_path)
        except FileExistsError:
            for opened_file in opened_files:
                opened_file.close()
            for path in created_paths:
                path.unlink(missing_ok=True)
            timestamp_ms += 1
            continue
        except Exception:
            # 非冲突类创建失败同样回滚，避免留下空文件或泄漏已打开的句柄。
            for opened_file in opened_files:
                opened_file.close()
            for path in created_paths:
                path.unlink(missing_ok=True)
            raise

        try:
            for (_path, image), opened_file in zip(images, opened_files[:-1], strict=True):
                image.save(opened_file, format="PNG")
            opened_files[-1].write(metrics_bytes)
        except Exception:
            for opened_file in opened_files:
                opened_file.close()
            for path in created_paths:
                path.unlink(missing_ok=True)
            raise
        finally:
            for opened_file in opened_files:
                opened_file.close()

        return (*tuple(path for path, _image in images), metrics_path)
