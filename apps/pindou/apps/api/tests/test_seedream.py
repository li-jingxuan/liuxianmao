from __future__ import annotations

import base64
from io import BytesIO
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image
from volcenginesdkarkruntime._exceptions import ArkAPITimeoutError, ArkBadRequestError

from pindou.core.config import Settings
from pindou.core.errors import ApiError
from pindou.imaging.color_budget import ColorBudgetBand, GridDetailBand, classify_grid_detail
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import EnhancementOptions, NativeAlphaHint
from pindou.services.seedream_client import SeedreamClient, SeedreamUpstreamError
from pindou.services.seedream_enhancer import SeedreamEnhancer
from pindou.services.seedream_prompt import (
    SEEDREAM_PROMPT_VERSION,
    build_seedream_prompt,
    normalize_background_color,
)


def make_png_bytes(
    color: tuple[int, int, int, int] = (20, 40, 60, 255),
    *,
    native_alpha: bool = True,
) -> bytes:
    mode = "RGBA" if native_alpha else "RGB"
    image = Image.new(mode, (12, 10), color if native_alpha else color[:3])
    output = BytesIO()
    image.save(output, format="PNG")
    image.close()
    return output.getvalue()


def make_valid_alpha_png() -> bytes:
    image = Image.new("RGBA", (12, 10), (20, 40, 60, 0))
    for x in range(2, 10):
        for y in range(2, 8):
            image.putpixel((x, y), (220, 30, 40, 255))
    output = BytesIO()
    image.save(output, format="PNG")
    image.close()
    return output.getvalue()


class FakeArk:
    def __init__(self, response: object | None = None, error: Exception | None = None) -> None:
        self.images = self
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []
        self.close_count = 0

    def generate(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response

    def close(self) -> None:
        self.close_count += 1


def sdk_response(content: bytes, *, request_id: str = "ark_req_1") -> object:
    return SimpleNamespace(
        model="actual-model",
        data=[SimpleNamespace(b64_json=base64.b64encode(content).decode(), size="12x10")],
        usage=SimpleNamespace(generated_images=1),
        _request_id=request_id,
    )


def make_client(ark: FakeArk, *, max_bytes: int = 1024 * 1024) -> SeedreamClient:
    return SeedreamClient(
        client=ark,
        model="doubao-seedream-5-0-pro-260628",
        image_size="2K",
        watermark=False,
        max_response_bytes=max_bytes,
    )


def options(mode: BackgroundMode) -> EnhancementOptions:
    return EnhancementOptions(
        grid_size=52,
        color_budget_band=ColorBudgetBand.BALANCED,
        background_mode=mode,
        conversion_style=ConversionStyle.ORIGINAL,
    )


@pytest.mark.parametrize(
    ("mode", "expected", "unexpected"),
    [
        (BackgroundMode.SIMPLIFY, "可以删除无关小物体", "PNG 原生透明"),
        (BackgroundMode.KEEP, "不能删除整个有语义的背景物体", "PNG 原生透明"),
        (BackgroundMode.SOLID, "PNG 原生透明背景", "严格填充为单一颜色"),
    ],
)
def test_prompts_are_isolated_by_background_mode(
    mode: BackgroundMode,
    expected: str,
    unexpected: str,
) -> None:
    prompt = build_seedream_prompt(options(mode))
    assert expected in prompt
    assert unexpected not in prompt
    assert "不要绘制像素格" in prompt


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
def test_grid_detail_band_boundaries(grid_size: int, expected_band: GridDetailBand) -> None:
    assert classify_grid_detail(grid_size) is expected_band


@pytest.mark.parametrize("style", list(ConversionStyle))
def test_prompt_supports_every_conversion_style(style: ConversionStyle) -> None:
    prompt = build_seedream_prompt(
        EnhancementOptions(
            grid_size=52,
            color_budget_band=ColorBudgetBand.BALANCED,
            background_mode=BackgroundMode.KEEP,
            conversion_style=style,
        )
    )
    assert "缩小为 52×52 个采样单元" in prompt


def test_solid_prompt_requires_native_alpha_not_chroma() -> None:
    prompt = build_seedream_prompt(options(BackgroundMode.SOLID))
    assert "主体以外区域和主体内部真实镂空区域" in prompt
    assert "PNG 原生透明背景" in prompt
    assert "不得使用白底、纯色键色、棋盘格" in prompt
    assert normalize_background_color(None) == "#FFFFFF"


def test_sdk_adapter_sends_only_single_image_generation_fields() -> None:
    output = make_valid_alpha_png()
    ark = FakeArk(sdk_response(output))
    client = make_client(ark)
    try:
        result = client.edit_image(
            image_data_url="data:image/png;base64,AAAA",
            prompt="中文提示词",
            background="transparent",
        )
    finally:
        client.close()

    assert result.image_bytes == output
    assert result.model == "actual-model"
    assert result.upstream_request_id == "ark_req_1"
    assert ark.calls == [
        {
            "model": "doubao-seedream-5-0-pro-260628",
            "prompt": "中文提示词",
            "image": "data:image/png;base64,AAAA",
            "size": "2K",
            "response_format": "b64_json",
            "output_format": "png",
            "watermark": False,
            "extra_body": {"background": "transparent"},
        }
    ]
    assert "stream" not in ark.calls[0]
    assert "sequential_image_generation" not in ark.calls[0]
    assert ark.close_count == 1


def test_sdk_adapter_omits_background_for_keep_and_simplify() -> None:
    for mode in (BackgroundMode.KEEP, BackgroundMode.SIMPLIFY):
        ark = FakeArk(sdk_response(make_png_bytes(native_alpha=False)))
        enhancer = SeedreamEnhancer(
            client=make_client(ark),
            model="doubao-seedream-5-0-pro-260628",
            input_max_edge=512,
            output_max_pixels=1_000_000,
            max_concurrency=1,
            queue_timeout_seconds=1,
        )
        source = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
        try:
            result = enhancer.enhance(source, options=options(mode))
            result.image.close()
        finally:
            source.close()
            enhancer.close()
        assert "extra_body" not in ark.calls[0]
        assert ark.calls[0]["output_format"] == "png"


def test_solid_enhancer_declares_native_alpha_hint(tmp_path) -> None:
    output = make_valid_alpha_png()
    ark = FakeArk(sdk_response(output))
    enhancer = SeedreamEnhancer(
        client=make_client(ark),
        model="doubao-seedream-5-0-pro-260628",
        input_max_edge=512,
        output_max_pixels=1_000_000,
        max_concurrency=1,
        queue_timeout_seconds=1,
        image_backup_dir=tmp_path,
    )
    source = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    try:
        result = enhancer.enhance(source, options=options(BackgroundMode.SOLID))
        try:
            assert isinstance(result.background_hint, NativeAlphaHint)
            assert result.image.getchannel("A").getextrema() == (0, 255)
            encoded = str(ark.calls[0]["image"]).split(",", 1)[1]
            with Image.open(BytesIO(base64.b64decode(encoded))) as request_image:
                assert request_image.mode == "RGBA"
                assert request_image.getpixel((0, 0)) == (0, 0, 0, 0)
            saved = list(tmp_path.glob("*-ark-response.png"))
            assert len(saved) == 1
            assert saved[0].read_bytes() == output
        finally:
            result.image.close()
    finally:
        source.close()
        enhancer.close()


def test_solid_enhancer_does_not_claim_alpha_for_rgb_png() -> None:
    ark = FakeArk(sdk_response(make_png_bytes(native_alpha=False)))
    enhancer = SeedreamEnhancer(
        client=make_client(ark),
        model="doubao-seedream-5-0-pro-260628",
        input_max_edge=512,
        output_max_pixels=1_000_000,
        max_concurrency=1,
        queue_timeout_seconds=1,
    )
    source = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    try:
        result = enhancer.enhance(source, options=options(BackgroundMode.SOLID))
        try:
            assert result.background_hint is None
        finally:
            result.image.close()
    finally:
        source.close()
        enhancer.close()


def test_enhancer_rejects_non_png_upstream_image() -> None:
    image = Image.new("RGB", (12, 10), (20, 40, 60))
    output = BytesIO()
    image.save(output, format="JPEG")
    image.close()
    ark = FakeArk(sdk_response(output.getvalue()))
    enhancer = SeedreamEnhancer(
        client=make_client(ark),
        model="doubao-seedream-5-0-pro-260628",
        input_max_edge=512,
        output_max_pixels=1_000_000,
        max_concurrency=1,
        queue_timeout_seconds=1,
    )
    source = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
    try:
        with pytest.raises(ApiError) as raised:
            enhancer.enhance(source, options=options(BackgroundMode.KEEP))
    finally:
        source.close()
        enhancer.close()
    assert raised.value.code == "AI_UPSTREAM_ERROR"


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(data=[]),
        SimpleNamespace(data=[SimpleNamespace(b64_json=""), SimpleNamespace(b64_json="AAAA")]),
        SimpleNamespace(data=[SimpleNamespace(b64_json="***")]),
    ],
)
def test_sdk_adapter_rejects_invalid_response(response: object) -> None:
    client = make_client(FakeArk(response))
    with pytest.raises(SeedreamUpstreamError):
        client.edit_image(image_data_url="data:image/png;base64,AAAA", prompt="x", background=None)


def test_sdk_adapter_enforces_decoded_image_byte_limit() -> None:
    client = make_client(FakeArk(sdk_response(make_valid_alpha_png())), max_bytes=8)
    with pytest.raises(SeedreamUpstreamError) as raised:
        client.edit_image(image_data_url="data:image/png;base64,AAAA", prompt="x", background=None)
    assert raised.value.code == "RESPONSE_TOO_LARGE"


def test_sdk_adapter_maps_timeout_and_api_status(tmp_path) -> None:
    request = httpx.Request("POST", "https://ark.example/images/generations")
    timeout_client = make_client(FakeArk(error=ArkAPITimeoutError(request, "req_timeout")))
    timeout_enhancer = SeedreamEnhancer(
        client=timeout_client,
        model="doubao-seedream-5-0-pro-260628",
        input_max_edge=512,
        output_max_pixels=1_000_000,
        max_concurrency=1,
        queue_timeout_seconds=1,
        event_log_dir=tmp_path,
    )
    with pytest.raises(SeedreamUpstreamError) as timeout:
        timeout_client.edit_image(image_data_url="x", prompt="x", background=None)
    assert timeout.value.status_code == 504
    assert timeout.value.request_id == "req_timeout"
    with pytest.raises(ApiError) as mapped_timeout:
        timeout_enhancer.enhance(Image.new("RGBA", (2, 2)), options=options(BackgroundMode.SOLID))
    assert mapped_timeout.value.code == "AI_TIMEOUT"
    events = list(tmp_path.glob("*-ark_upstream_failure.json"))
    assert len(events) == 1
    assert "req_timeout" in events[0].read_text(encoding="utf-8")
    timeout_enhancer.close()


def test_sdk_adapter_extracts_nested_output_policy_code() -> None:
    request = httpx.Request("POST", "https://ark.invalid")
    response = httpx.Response(400, request=request)
    body = {
        "error": {
            "code": "OutputImageSensitiveContentDetected.PolicyViolation",
            "message": "copyright restriction",
        }
    }
    client = make_client(
        FakeArk(
            error=ArkBadRequestError(
                "error code: 400 - nested body",
                response=response,
                body=body,
                request_id="req_policy",
            )
        )
    )
    try:
        with pytest.raises(SeedreamUpstreamError) as caught:
            client.edit_image(image_data_url="x", prompt="x", background=None)
    finally:
        client.close()

    assert caught.value.code == "OutputImageSensitiveContentDetected.PolicyViolation"
    mapped = SeedreamEnhancer._map_upstream_error(caught.value)
    assert mapped.status_code == 422
    assert mapped.code == "AI_OUTPUT_REJECTED"

    response = httpx.Response(400, request=request)
    api_client = make_client(
        FakeArk(
            error=ArkBadRequestError(
                "rejected",
                response=response,
                body={"error": {"code": "InputTextSensitiveContentDetected"}},
                request_id="req_rejected",
            )
        )
    )
    with pytest.raises(SeedreamUpstreamError) as rejected:
        api_client.edit_image(image_data_url="x", prompt="x", background=None)
    assert rejected.value.code == "InputTextSensitiveContentDetected"
    assert rejected.value.request_id == "req_rejected"


@pytest.mark.parametrize(
    ("upstream_code", "status_code", "expected_code"),
    [
        ("InputTextSensitiveContentDetected", 400, "AI_INPUT_REJECTED"),
        ("OutputImageSensitiveContentDetected", 400, "AI_OUTPUT_REJECTED"),
        ("QuotaExceeded", 429, "AI_QUOTA_EXCEEDED"),
        ("TIMEOUT", 504, "AI_TIMEOUT"),
    ],
)
def test_enhancer_maps_stable_business_errors(
    upstream_code: str,
    status_code: int,
    expected_code: str,
) -> None:
    exc = SeedreamUpstreamError(status_code, upstream_code, "upstream")
    mapped = SeedreamEnhancer._map_upstream_error(exc)
    assert mapped.code == expected_code
    assert mapped.provider == "ark"
    assert mapped.provider_code == upstream_code


def test_seedream_settings_use_pro_model_and_hide_key() -> None:
    with pytest.raises(ValueError, match="ARK_DOUBAO_API_KEY"):
        Settings(_env_file=None, image_enhancer="seedream", ark_doubao_api_key=None)
    settings = Settings(
        _env_file=None,
        image_enhancer="seedream",
        ark_doubao_api_key="very-secret-key",
    )
    assert "very-secret-key" not in repr(settings)
    assert settings.ark_doubao_image_model == "doubao-seedream-5-0-pro-260628"
    assert SEEDREAM_PROMPT_VERSION == "seedream-pindou-v13-transparent-background"
