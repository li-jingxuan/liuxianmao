"""从环境变量和 API 目录的 `.env` 读取运行配置。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_color_chart_path() -> Path:
    """根据当前源码位置定位仓库中的唯一 MARD 色卡源文件。

    `config.py` 位于 `apps/api/src/pindou/core/`，向上五级就是仓库根目录。
    默认直接读取 `docs/MARD_色卡.json`，避免复制色卡后出现两份数据漂移。
    部署环境若改变目录结构，可以用 `MARD_COLOR_CHART_PATH` 显式覆盖。
    """
    return Path(__file__).resolve().parents[5] / "docs" / "MARD_色卡.json"


API_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """应用的不可变、类型化运行配置。

    真实进程环境优先于 `apps/api/.env`。SecretStr 会在 repr 中脱敏，
    防止日志或启动异常意外暴露方舟 API Key。
    """

    model_config = SettingsConfigDict(
        env_file=API_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        frozen=True,
        extra="ignore",
    )

    # 环境名称只用于日志和未来的环境差异配置。
    app_env: str = "development"
    # 默认监听所有 IPv4 网卡，局域网设备可通过宿主机 IP 访问。
    api_host: str = "0.0.0.0"
    api_port: int = Field(default=8000, ge=1, le=65535)
    api_reload: bool = True
    image_enhancer: str = "passthrough"
    # 同时限制压缩文件体积和解码后像素量，防止压缩炸弹耗尽内存。
    upload_max_bytes: int = 10 * 1024 * 1024
    upload_max_pixels: int = 25_000_000
    # 网格边长允许 8–156；52、78、104 只是前端快捷预设，不是后端唯一合法值。
    min_grid_size: int = 8
    max_grid_size: int = 156
    # 前端通过颜色组接口读取此默认值，但转换请求仍必须显式提交颜色组。
    default_color_set_size: int = 264
    color_chart_path: Path = Field(
        default_factory=_default_color_chart_path,
        validation_alias="MARD_COLOR_CHART_PATH",
    )

    # 方舟密钥仅在 seedream 模式下必需，passthrough 可无 Key 运行。
    ark_doubao_api_key: SecretStr | None = None
    ark_doubao_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_doubao_image_model: str = "doubao-seedream-5-0-lite-260128"
    ark_doubao_image_size: str = "2K"
    ark_doubao_response_format: str = "b64_json"
    ark_doubao_watermark: bool = True
    ark_doubao_connect_timeout_seconds: float = 5.0
    ark_doubao_read_timeout_seconds: float = 90.0
    ark_doubao_write_timeout_seconds: float = 15.0
    ark_doubao_pool_timeout_seconds: float = 5.0
    ark_doubao_max_concurrency: int = Field(default=2, ge=1, le=32)
    ark_doubao_queue_timeout_seconds: float = Field(default=3.0, gt=0)
    ark_doubao_max_response_bytes: int = Field(default=30 * 1024 * 1024, ge=1024)
    seedream_input_max_edge: int = Field(default=2048, ge=256, le=8192)
    seedream_output_max_pixels: int = Field(default=20_000_000, ge=1_000_000)
    seedream_prompt_version: str = "seedream-pindou-v2"

    @model_validator(mode="after")
    def validate_seedream_configuration(self) -> Settings:
        """在启动期拒绝不完整的 AI 配置，不静默降级。"""
        if self.image_enhancer not in {"passthrough", "seedream"}:
            raise ValueError("IMAGE_ENHANCER 仅支持 passthrough 或 seedream")
        if self.image_enhancer == "seedream":
            if self.ark_doubao_api_key is None or not self.ark_doubao_api_key.get_secret_value():
                raise ValueError("IMAGE_ENHANCER=seedream 时必须配置 ARK_DOUBAO_API_KEY")
            if not self.ark_doubao_image_model.strip():
                raise ValueError("IMAGE_ENHANCER=seedream 时必须配置 ARK_DOUBAO_IMAGE_MODEL")
        if self.ark_doubao_response_format != "b64_json":
            raise ValueError("MVP2 仅支持 ARK_DOUBAO_RESPONSE_FORMAT=b64_json")
        return self


@lru_cache
def get_settings() -> Settings:
    """每个进程只解析一次配置，测试可清理缓存后重建。"""
    return Settings()
