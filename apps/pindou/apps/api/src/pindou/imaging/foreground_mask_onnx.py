"""基于 ONNX Runtime 的 U-2-NetP 类别无关前景 Adapter。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any

from PIL import Image

from pindou.core.errors import ApiError
from pindou.imaging.foreground import RawForegroundMask


class _InvalidModelOutput(ValueError):
    pass


class OnnxForegroundMaskAdapter:
    """加载固定模型并以有界并发生成软前景蒙版。"""

    def __init__(
        self,
        *,
        model_path: Path,
        metadata_path: Path,
        max_concurrency: int,
        queue_timeout_seconds: float,
        intra_op_threads: int,
        allow_spinning: bool,
    ) -> None:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        expected_sha256 = str(metadata["sha256"])
        actual_sha256 = hashlib.sha256(model_path.read_bytes()).hexdigest()
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
            resized = rgb.resize(self._input_size, Image.Resampling.LANCZOS)
            try:
                tensor = np.asarray(resized, dtype=np.float32).copy() / 255.0
            finally:
                resized.close()
        finally:
            rgb.close()
        tensor = (tensor - self._mean) / self._std
        tensor = np.transpose(tensor, (2, 0, 1))[np.newaxis, ...]
        output: Any = self._session.run(
            [self._output_name],
            {self._input_name: np.ascontiguousarray(tensor, dtype=np.float32)},
        )[0]
        prediction = np.asarray(output, dtype=np.float32).squeeze()
        if prediction.ndim != 2 or not np.isfinite(prediction).all():
            raise _InvalidModelOutput("foreground model returned an invalid output tensor")
        minimum = float(prediction.min())
        maximum = float(prediction.max())
        if maximum - minimum <= 1e-6:
            raise _InvalidModelOutput("foreground model returned a constant mask")
        normalized = np.clip((prediction - minimum) / (maximum - minimum), 0.0, 1.0)
        mask = Image.fromarray((normalized * 255.0).round().astype(np.uint8), mode="L")
        if mask.size != image.size:
            restored = mask.resize(image.size, Image.Resampling.LANCZOS)
            mask.close()
            mask = restored
        return mask

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
