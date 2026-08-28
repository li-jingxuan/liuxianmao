"""按元数据来源下载并校验前景 ONNX 模型。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen

MODEL_ROOT = Path(__file__).resolve().parents[1] / "models" / "foreground"


def calculate_sha256(path: Path) -> str:
    """流式计算模型摘要，避免把大文件完整读入内存。"""
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        while chunk := model_file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download_model(*, variant: str, source_url: str | None = None) -> Path:
    """下载一个注册模型，以原子替换保证失败时不留下半成品。"""
    metadata_path = MODEL_ROOT / f"{variant}.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if str(metadata["name"]).strip().lower() != variant:
        raise RuntimeError(f"模型元数据与变体不匹配: {metadata_path}")

    expected_sha256 = str(metadata["sha256"])
    destination = MODEL_ROOT / f"{variant}.onnx"
    if destination.exists() and calculate_sha256(destination) == expected_sha256:
        print(f"模型已存在且校验通过: {destination}")
        return destination

    url = source_url or str(metadata["artifact_source"])
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{variant}.",
            suffix=".download",
            dir=MODEL_ROOT,
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            # 固定大小分块写入，避免完整 U²-Net 下载时造成额外内存峰值。
            with urlopen(url, timeout=60) as response:  # noqa: S310 - 来源由固定元数据控制。
                while chunk := response.read(1024 * 1024):
                    temporary_file.write(chunk)

        actual_sha256 = calculate_sha256(temporary_path)
        if actual_sha256 != expected_sha256:
            raise RuntimeError(
                f"模型 SHA256 校验失败: expected={expected_sha256}, actual={actual_sha256}"
            )
        os.replace(temporary_path, destination)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    print(f"模型下载并校验完成: {destination}")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="下载固定版本的前景 ONNX 模型")
    parser.add_argument("--variant", choices=("u2net", "u2netp"), default="u2net")
    parser.add_argument("--url", help="仅覆盖下载镜像地址，SHA256 仍以元数据为准")
    arguments = parser.parse_args()
    download_model(variant=arguments.variant, source_url=arguments.url)


if __name__ == "__main__":
    main()
