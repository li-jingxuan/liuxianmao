from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from pindou.core.config import Settings
from pindou.core.errors import ApiError
from pindou.imaging.color_budget import ColorBudgetBand, GridDetailBand, classify_grid_detail
from pindou.schemas.conversion import BackgroundMode
from pindou.services.enhancer import EnhancementOptions
from pindou.services.seedream_client import SeedreamClient, SeedreamUpstreamError
from pindou.services.seedream_enhancer import SeedreamEnhancer
from pindou.services.seedream_prompt import build_seedream_prompt, normalize_background_color


def make_png_bytes(color: tuple[int, int, int, int] = (20, 40, 60, 255)) -> bytes:
    image = Image.new("RGBA", (12, 10), color)
    output = BytesIO()
    image.save(output, format="PNG")
    image.close()
    return output.getvalue()


def make_client(handler: httpx.MockTransport) -> SeedreamClient:
    return SeedreamClient(
        api_key="test-secret",
        base_url="https://ark.example/api/v3",
        model="doubao-seedream-5-0-lite-260128",
        image_size="2K",
        watermark=True,
        max_response_bytes=1024 * 1024,
        timeout=httpx.Timeout(5),
        transport=handler,
    )


@pytest.mark.parametrize(
    ("mode", "expected", "unexpected"),
    [
        (BackgroundMode.SIMPLIFY, "可以删除无关小物体", "完整移除原背景"),
        (BackgroundMode.KEEP, "不能删除整个有语义的背景物体", "可以删除无关小物体"),
        (BackgroundMode.SOLID, "输出透明背景", "背景目标颜色为"),
    ],
)
def test_chinese_prompts_are_isolated_by_background_mode(
    mode: BackgroundMode,
    expected: str,
    unexpected: str,
) -> None:
    """三种中文背景提示词只组装当前模式片段。"""
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=52,
            color_budget_band=ColorBudgetBand.BALANCED,
            background_mode=mode,
        )
    )

    assert "缩小为 52×52 个采样单元" in prompt
    assert "主体轮廓优先（52×52 预设档）" in prompt
    assert "30" not in prompt
    assert "54" not in prompt
    assert "颜色预算：平衡" in prompt
    assert "不要绘制像素格" in prompt
    assert expected in prompt
    assert unexpected not in prompt


@pytest.mark.parametrize(
    ("grid_size", "expected_band"),
    [
        (8, GridDetailBand.MICRO),
        (31, GridDetailBand.MICRO),
        (32, GridDetailBand.SMALL),
        (63, GridDetailBand.SMALL),
        (64, GridDetailBand.MEDIUM),
        (95, GridDetailBand.MEDIUM),
        (96, GridDetailBand.LARGE),
        (156, GridDetailBand.LARGE),
    ],
)
def test_grid_detail_band_boundaries(
    grid_size: int,
    expected_band: GridDetailBand,
) -> None:
    assert classify_grid_detail(grid_size) is expected_band


@pytest.mark.parametrize(
    ("grid_size", "expected", "unexpected"),
    [
        (24, "极低分辨率图标化表达", "主体轮廓优先"),
        (52, "主体轮廓优先", "主体结构优先"),
        (78, "主体结构优先", "较高网格的克制保留"),
        (104, "较高网格的克制保留", "主体结构优先"),
    ],
)
def test_prompt_contains_only_selected_grid_detail_band(
    grid_size: int,
    expected: str,
    unexpected: str,
) -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=grid_size,
            color_budget_band=ColorBudgetBand.RICH,
            background_mode=BackgroundMode.KEEP,
        )
    )

    assert f"{grid_size}×{grid_size}" in prompt
    assert expected in prompt
    assert unexpected not in prompt


def test_prompt_restricts_changes_to_required_simplification() -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=52,
            color_budget_band=ColorBudgetBand.BALANCED,
            background_mode=BackgroundMode.SIMPLIFY,
        )
    )

    assert "只做后续缩小和有限色卡量化所必需的归纳与边界整理" in prompt
    assert "不主动增加细节、装饰、纹理或新的视觉重点" in prompt
    assert "优先保证主体整体可识别" in prompt
    assert "不添加输入图中不存在的角色、物体、肢体、文字、标志、边框或水印" in prompt


@pytest.mark.parametrize(
    ("grid_size", "expected_priorities"),
    [
        (52, ("主体外轮廓、姿态、头身大形", "2–4 个内部特征", "内部信息宁少勿碎")),
        (78, ("主体外轮廓与姿态、主要结构分区", "不主动放大局部特征", "先读出主体轮廓和姿态")),
        (104, ("较高网格的克制保留", "不主动放大或增加视觉权重", "避免照片式复刻")),
    ],
)
def test_preset_prompts_contain_expected_detail_priorities(
    grid_size: int,
    expected_priorities: tuple[str, ...],
) -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=grid_size,
            color_budget_band=ColorBudgetBand.RICH,
            background_mode=BackgroundMode.KEEP,
        )
    )

    for priority in expected_priorities:
        assert priority in prompt


@pytest.mark.parametrize(
    ("grid_size", "is_subject_first"),
    [(52, True), (78, True), (103, True), (104, False)],
)
def test_grids_below_104_reduce_background_detail(
    grid_size: int,
    is_subject_first: bool,
) -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=grid_size,
            color_budget_band=ColorBudgetBand.RICH,
            background_mode=BackgroundMode.KEEP,
        )
    )

    subject_first_text = "当前网格小于 104×104，主体是唯一视觉重点"
    assert (subject_first_text in prompt) is is_subject_first
    if is_subject_first:
        assert "使用比主体更少、更大、对比更弱的色块" in prompt
        assert "保留背景时维持有语义物体的类别、数量、位置和遮挡关系" in prompt


@pytest.mark.parametrize(
    ("color_budget_band", "expected", "unexpected"),
    [
        (ColorBudgetBand.RESTRAINED, "颜色预算：受限", "颜色预算：平衡"),
        (ColorBudgetBand.BALANCED, "颜色预算：平衡", "颜色预算：丰富但受控"),
        (ColorBudgetBand.RICH, "颜色预算：丰富但受控", "颜色预算：受限"),
    ],
)
def test_prompt_contains_only_selected_color_budget_band(
    color_budget_band: ColorBudgetBand,
    expected: str,
    unexpected: str,
) -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=52,
            color_budget_band=color_budget_band,
            background_mode=BackgroundMode.KEEP,
        )
    )

    assert "最多 30 种" not in prompt
    assert "最多 54 种" not in prompt
    assert "不要为了用满颜色预算而添加新颜色" in prompt
    assert expected in prompt
    assert unexpected not in prompt


def test_solid_background_prompt_requests_transparent_output() -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=52,
            color_budget_band=ColorBudgetBand.BALANCED,
            background_mode=BackgroundMode.SOLID,
            background_color="#aabbcc",
        )
    )

    assert "输出透明背景" in prompt
    assert "背景目标颜色为" not in prompt
    assert normalize_background_color(None) == "#FFFFFF"


def test_solid_enhancement_accepts_opaque_upstream_output() -> None:
    output = make_png_bytes((20, 40, 60, 255))

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"data": [{"b64_json": base64.b64encode(output).decode()}]},
        )

    enhancer = SeedreamEnhancer(
        client=make_client(httpx.MockTransport(handler)),
        model="test-model",
        prompt_version="test-prompt",
        input_max_edge=512,
        output_max_pixels=1_000_000,
        max_concurrency=1,
        queue_timeout_seconds=1,
    )
    image = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    try:
        enhanced = enhancer.enhance(
            image,
            options=EnhancementOptions(
                grid_size=52,
                color_budget_band=ColorBudgetBand.BALANCED,
                background_mode=BackgroundMode.SOLID,
                background_color="#FFFFFF",
            ),
        )
        assert enhanced.background_alpha_status == "opaque"
        assert enhanced.image.getchannel("A").getextrema() == (255, 255)
        enhanced.image.close()
    finally:
        image.close()
        enhancer.close()

def test_seedream_client_sends_single_non_streaming_image_and_decodes_response() -> None:
    output = make_png_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert request.headers["authorization"] == "Bearer test-secret"
        assert payload["sequential_image_generation"] == "disabled"
        assert payload["stream"] is False
        assert payload["response_format"] == "b64_json"
        assert payload["prompt"].startswith("中文提示词")
        assert payload["image"].startswith("data:image/png;base64,")
        return httpx.Response(
            200,
            headers={"x-request-id": "ark_req_1"},
            json={
                "model": "actual-model",
                "data": [{"b64_json": base64.b64encode(output).decode(), "size": "12x10"}],
                "usage": {"generated_images": 1},
            },
        )

    client = make_client(httpx.MockTransport(handler))
    try:
        result = client.edit_image(
            image_data_url="data:image/png;base64,AAAA",
            prompt="中文提示词：简化背景",
        )
    finally:
        client.close()

    assert result.image_bytes == output
    assert result.model == "actual-model"
    assert result.upstream_request_id == "ark_req_1"


@pytest.mark.parametrize(
    ("upstream_code", "expected_code"),
    [
        ("InputTextSensitiveContentDetected", "AI_INPUT_REJECTED"),
        ("OutputImageSensitiveContentDetected", "AI_OUTPUT_REJECTED"),
        ("QuotaExceeded", "AI_BUSY"),
    ],
)
def test_enhancer_maps_official_error_codes(upstream_code: str, expected_code: str) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429 if upstream_code == "QuotaExceeded" else 400,
            json={"error": {"code": upstream_code, "message": "upstream detail"}},
        )

    client = make_client(httpx.MockTransport(handler))
    enhancer = SeedreamEnhancer(
        client=client,
        model="test-model",
        prompt_version="seedream-pindou-v2",
        input_max_edge=512,
        output_max_pixels=1_000_000,
        max_concurrency=1,
        queue_timeout_seconds=1,
    )
    image = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    try:
        with pytest.raises(ApiError) as raised:
            enhancer.enhance(
                image,
                options=EnhancementOptions(
                    grid_size=52,
                    color_budget_band=ColorBudgetBand.BALANCED,
                    background_mode=BackgroundMode.KEEP,
                ),
            )
    finally:
        image.close()
        enhancer.close()

    assert raised.value.code == expected_code


def test_seedream_settings_require_key_without_exposing_it() -> None:
    with pytest.raises(ValueError, match="ARK_DOUBAO_API_KEY"):
        Settings(_env_file=None, image_enhancer="seedream", ark_doubao_api_key=None)

    settings = Settings(
        _env_file=None,
        image_enhancer="seedream",
        ark_doubao_api_key="very-secret-key",
    )
    assert "very-secret-key" not in repr(settings)
    assert settings.seedream_prompt_version == "seedream-pindou-v7-subject-first"


def test_client_rejects_invalid_base64() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"b64_json": "***"}]})

    client = make_client(httpx.MockTransport(handler))
    try:
        with pytest.raises(SeedreamUpstreamError, match="无效图片"):
            client.edit_image(image_data_url="data:image/png;base64,AAAA", prompt="中文")
    finally:
        client.close()
