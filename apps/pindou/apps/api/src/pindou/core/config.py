"""从环境变量读取 MVP1 的运行限制和组件选择。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_color_chart_path() -> Path:
    """根据当前源码位置定位仓库中的唯一 MARD 色卡源文件。

    `config.py` 位于 `apps/api/src/pindou/core/`，向上五级就是仓库根目录。
    默认直接读取 `docs/MARD_色卡.json`，避免复制色卡后出现两份数据漂移。
    部署环境若改变目录结构，可以用 `MARD_COLOR_CHART_PATH` 显式覆盖。
    """
    return Path(__file__).resolve().parents[5] / "docs" / "MARD_色卡.json"


@dataclass(frozen=True, slots=True)
class Settings:
    """MVP1 的不可变运行配置。

    当前不引入复杂配置框架，启动时直接读取环境变量。使用冻结的数据类可以
    避免请求处理中意外改写限制值，也便于测试时整体替换 FastAPI 依赖。
    """

    # 环境名称只用于日志和未来的环境差异配置。
    app_env: str = os.getenv("APP_ENV", "development")
    # MVP1 固定为 passthrough；保留字段是为了以后无侵入切换 SeedreamEnhancer。
    image_enhancer: str = os.getenv("IMAGE_ENHANCER", "passthrough")
    # 同时限制压缩文件体积和解码后像素量，防止压缩炸弹耗尽内存。
    upload_max_bytes: int = int(os.getenv("UPLOAD_MAX_BYTES", str(10 * 1024 * 1024)))
    upload_max_pixels: int = int(os.getenv("UPLOAD_MAX_PIXELS", "25000000"))
    # 网格边长允许 8–156；52、78、104 只是前端快捷预设，不是后端唯一合法值。
    min_grid_size: int = int(os.getenv("MIN_GRID_SIZE", "8"))
    max_grid_size: int = int(os.getenv("MAX_GRID_SIZE", "156"))
    # 前端通过颜色组接口读取此默认值，但转换请求仍必须显式提交颜色组。
    default_color_set_size: int = int(os.getenv("DEFAULT_COLOR_SET_SIZE", "264"))
    color_chart_path: Path = Path(
        os.getenv("MARD_COLOR_CHART_PATH", str(_default_color_chart_path()))
    )


# 配置对象在进程启动时构造一次，后续由 FastAPI 依赖注入复用。
settings = Settings()
