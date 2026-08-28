"""基于 ONNX Runtime 的 U²-Net 系列类别无关前景 Adapter。"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any

from PIL import Image, ImageOps

from pindou.core.errors import ApiError
from pindou.imaging.foreground import RawForegroundMask

logger = logging.getLogger(__name__)


class _InvalidModelOutput(ValueError):
    pass


def _calculate_sha256(path: Path) -> str:
    """流式计算大模型摘要，避免启动时额外占用一份完整模型内存。"""
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        while chunk := model_file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _normalize_prediction(prediction: Any, *, output_activation: str) -> Any:
    """按模型声明解释输出，禁止用逐图 min-max 破坏绝对置信度。"""
    import numpy as np

    values = np.asarray(prediction, dtype=np.float32)
    if not np.isfinite(values).all():
        raise _InvalidModelOutput("foreground model returned non-finite values")
    if output_activation == "probability":
        # 允许浮点计算产生极小越界，但明显超出概率范围说明模型元数据不匹配。
        if float(values.min()) < -1e-4 or float(values.max()) > 1.0001:
            raise _InvalidModelOutput("foreground probability output is outside 0..1")
        return np.clip(values, 0.0, 1.0)
    if output_activation == "logits":
        # 分正负区间计算 sigmoid，避免大幅 logits 的 exp 溢出。
        result = np.empty_like(values, dtype=np.float32)
        non_negative = values >= 0
        result[non_negative] = 1.0 / (1.0 + np.exp(-values[non_negative]))
        negative_exp = np.exp(values[~non_negative])
        result[~non_negative] = negative_exp / (1.0 + negative_exp)
        return result
    raise RuntimeError(f"Unsupported foreground output activation: {output_activation}")


class OnnxForegroundMaskAdapter:
    """加载固定模型并以有界并发生成软前景蒙版。"""

    def __init__(
        self,
        *,
        model_path: Path,
        metadata_path: Path,
        expected_model_name: str,
        max_concurrency: int,
        queue_timeout_seconds: float,
        intra_op_threads: int,
        allow_spinning: bool,
    ) -> None:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata_name = str(metadata["name"]).strip().lower()
        if metadata_name != expected_model_name:
            raise RuntimeError(
                "Foreground model metadata mismatch: "
                f"expected {expected_model_name}, got {metadata_name}"
            )
        expected_sha256 = str(metadata["sha256"])
        actual_sha256 = _calculate_sha256(model_path)
        if actual_sha256 != expected_sha256:
            raise RuntimeError(
                "Foreground model SHA-256 mismatch: "
                f"expected {expected_sha256}, got {actual_sha256}"
            )

        try:
            import numpy as np
            import onnxruntime as ort
        except ImportError as exc:  # pragma: no cover - 由部署启动检查覆盖。
            raise RuntimeError("onnxruntime and numpy are required for foreground masking") from exc

        session_options = ort.SessionOptions()
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session_options.intra_op_num_threads = intra_op_threads
        session_options.inter_op_num_threads = 1
        session_options.add_session_config_entry(
            "session.intra_op.allow_spinning", "1" if allow_spinning else "0"
        )
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._session = ort.InferenceSession(
            str(model_path),
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )
        self._np = np
        self._input_name = self._session.get_inputs()[0].name
        self._output_name = self._session.get_outputs()[0].name
        input_size = metadata.get("input_size", [320, 320])
        self._input_size = (int(input_size[0]), int(input_size[1]))
        self._mean = np.asarray(metadata["normalization"]["mean"], dtype=np.float32)
        self._std = np.asarray(metadata["normalization"]["std"], dtype=np.float32)
        self._output_activation = str(metadata["output_activation"])
        if self._output_activation not in {"probability", "logits"}:
            raise RuntimeError(
                f"Unsupported foreground output activation: {self._output_activation}"
            )
        self._name = str(metadata["name"])
        self._model_version = str(metadata["version"])
        self._queue_timeout_seconds = queue_timeout_seconds
        self._semaphore = BoundedSemaphore(max_concurrency)
        self._ready = True
        warmup = Image.new("RGB", (16, 16), (127, 127, 127))
        try:
            self._infer(warmup)
        finally:
            warmup.close()
        # 启动日志明确输出实际加载模型，便于确认全局开关和线上回滚是否生效。
        logger.info(
            "前景模型已加载: variant=%s name=%s version=%s path=%s sha256=%s provider=%s",
            expected_model_name,
            self._name,
            self._model_version,
            model_path,
            actual_sha256,
            self._session.get_providers()[0],
            extra={
                "foreground_model_variant": expected_model_name,
                "foreground_model_name": self._name,
                "foreground_model_version": self._model_version,
                "foreground_model_path": str(model_path),
                "foreground_model_sha256": actual_sha256,
                "onnx_provider": self._session.get_providers()[0],
            },
        )

    @property
    def name(self) -> str:
        return self._name

    @property
    def model_version(self) -> str:
        return self._model_version

    @property
    def ready(self) -> bool:
        return self._ready

    def _infer(self, image: Image.Image) -> Image.Image:
        np = self._np
        rgb = image.convert("RGB")
        try:
            # 等比缩放并补边，避免非方图直接拉伸后改变主体比例和多主体间距。
            fitted = ImageOps.contain(rgb, self._input_size, Image.Resampling.LANCZOS)
            try:
                fitted_size = fitted.size
                left = (self._input_size[0] - fitted_size[0]) // 2
                top = (self._input_size[1] - fitted_size[1]) // 2
                canvas = Image.new("RGB", self._input_size, (127, 127, 127))
                try:
                    canvas.paste(fitted, (left, top))
                    tensor = np.asarray(canvas, dtype=np.float32).copy() / 255.0
                finally:
                    canvas.close()
            finally:
                fitted.close()
        finally:
            rgb.close()
        tensor = (tensor - self._mean) / self._std
        tensor = np.transpose(tensor, (2, 0, 1))[np.newaxis, ...]
        output: Any = self._session.run(
            [self._output_name],
            {self._input_name: np.ascontiguousarray(tensor, dtype=np.float32)},
        )[0]
        prediction = np.asarray(output, dtype=np.float32).squeeze()
        if prediction.ndim != 2:
            raise _InvalidModelOutput("foreground model returned an invalid output tensor")
        normalized = _normalize_prediction(
            prediction,
            output_activation=self._output_activation,
        )
        if float(normalized.max()) - float(normalized.min()) <= 1e-6:
            raise _InvalidModelOutput("foreground model returned a constant mask")
        mask = Image.fromarray((normalized * 255.0).round().astype(np.uint8), mode="L")
        try:
            # 先移除模型输入补边，再恢复到增强图完整原尺寸，保证蒙版逐像素对齐。
            cropped = mask.crop((left, top, left + fitted_size[0], top + fitted_size[1]))
            try:
                restored = cropped.resize(image.size, Image.Resampling.LANCZOS)
            finally:
                cropped.close()
        finally:
            mask.close()
        return restored

    def generate(self, image: Image.Image) -> RawForegroundMask:
        acquired = self._semaphore.acquire(timeout=self._queue_timeout_seconds)
        if not acquired:
            raise ApiError(503, "FOREGROUND_MASK_BUSY", "主体识别繁忙，请稍后重试")
        try:
            try:
                mask = self._infer(image)
            except _InvalidModelOutput as exc:
                raise ApiError(
                    500,
                    "FOREGROUND_MASK_INVALID_OUTPUT",
                    "主体识别输出异常，请稍后重试",
                ) from exc
            except Exception as exc:
                raise ApiError(
                    503,
                    "FOREGROUND_MASK_UNAVAILABLE",
                    "主体识别能力暂时不可用，请稍后重试",
                ) from exc
        finally:
            self._semaphore.release()
        return RawForegroundMask(
            mask=mask,
            model_name=self.name,
            model_version=self.model_version,
        )
