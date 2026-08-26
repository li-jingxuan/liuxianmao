from __future__ import annotations

import pytest
from PIL import Image

from pindou.core.errors import ApiError
from pindou.imaging.color_budget import ColorBudgetBand
from pindou.imaging.foreground import prepare_foreground
from pindou.schemas.conversion import BackgroundMode
from pindou.services.enhancer import EnhancementOptions, EnhancementResult


class _ChromaKeyEnhancer:
    """用确定性图片模拟遵循内部键色要求的 Seedream。"""

    name = "test-chroma"
    model = "test"
    prompt_version = "test"

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del image
        assert options.chroma_key is not None
        key = tuple(int(options.chroma_key[index : index + 2], 16) for index in (1, 3, 5))
        output = Image.new("RGBA", (7, 7), (*key, 255))

        # 深色轮廓顶部故意留一个缺口。旧的白底 flood-fill 会从缺口进入主体内部，
        # 新算法只允许键色背景通过，因此内部白色仍必须保留。
        for x in range(1, 6):
            for y in range(1, 6):
                if x in (1, 5) or y in (1, 5):
                    output.putpixel((x, y), (20, 20, 20, 255))
        output.putpixel((3, 1), (255, 255, 255, 255))
        for x in range(2, 5):
            for y in range(2, 5):
                output.putpixel((x, y), (255, 255, 255, 255))
        return EnhancementResult(image=output)


class _InvalidAlphaEnhancer:
    """模拟只有一个随机透明像素、同时忽略键色要求的异常上游结果。"""

    name = "test-invalid-alpha"
    model = "test"
    prompt_version = "test"

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del image, options
        output = Image.new("RGBA", (12, 12), (255, 255, 255, 255))
        output.putpixel((0, 0), (255, 255, 255, 0))
        return EnhancementResult(image=output)


class _ChromaSpillEnhancer:
    """模拟 Seedream 将青色键背景混入主体边缘的真实异常输出。"""

    name = "test-chroma-spill"
    model = "test"
    prompt_version = "test"

    def enhance(self, image: Image.Image, *, options: EnhancementOptions) -> EnhancementResult:
        del image
        assert options.chroma_key is not None
        requested_key = tuple(
            int(options.chroma_key[index : index + 2], 16) for index in (1, 3, 5)
        )
        subject = (220, 170, 120)

        # 模型会把请求键色向主体色漂移约 12%，实现不能只拿请求值做固定距离判断。
        actual_key = tuple(
            round(key_channel * 0.88 + subject_channel * 0.12)
            for key_channel, subject_channel in zip(requested_key, subject, strict=True)
        )
        output = Image.new("RGBA", (9, 9), (*actual_key, 255))

        # 中心是棕色主体；外圈模拟键色与主体抗锯齿混合后的青绿色污染。
        # 污染边缘再混入约 30% 主体色，到请求键色的距离会稳定越过旧阈值 80。
        spill = tuple(
            round(key_channel * 0.70 + subject_channel * 0.30)
            for key_channel, subject_channel in zip(actual_key, subject, strict=True)
        )
        for x in range(2, 7):
            for y in range(2, 7):
                output.putpixel((x, y), (*spill, 255))
        for x in range(3, 6):
            for y in range(3, 6):
                output.putpixel((x, y), (*subject, 255))
        return EnhancementResult(image=output)


def _solid_options() -> EnhancementOptions:
    return EnhancementOptions(
        grid_size=52,
        color_budget_band=ColorBudgetBand.BALANCED,
        background_mode=BackgroundMode.SOLID,
        background_color="#FFFFFF",
    )


def test_prepare_foreground_preserves_white_subject_connected_through_outline_gap() -> None:
    """已知键色只能删除键色背景，不能沿轮廓缺口误删白色主体。"""
    source = Image.new("RGBA", (7, 7), (240, 240, 240, 255))
    try:
        prepared = prepare_foreground(
            source,
            enhancer=_ChromaKeyEnhancer(),
            options=_solid_options(),
        )
        try:
            assert prepared.processing == "chroma_key"
            assert all(
                prepared.image.getpixel((x, y))[3] == 255
                for x in range(2, 5)
                for y in range(2, 5)
            )
            assert prepared.image.getpixel((0, 0))[3] == 0
        finally:
            prepared.image.close()
    finally:
        source.close()


def test_prepare_foreground_rejects_single_random_transparent_pixel() -> None:
    """单个透明像素不能再让整张不透明白底图冒充有效 Alpha 蒙版。"""
    source = Image.new("RGBA", (12, 12), (30, 60, 90, 255))
    try:
        with pytest.raises(ApiError) as raised:
            prepare_foreground(
                source,
                enhancer=_InvalidAlphaEnhancer(),
                options=_solid_options(),
            )
    finally:
        source.close()

    assert raised.value.code == "AI_BACKGROUND_SEPARATION_FAILED"


def test_prepare_foreground_accepts_meaningful_native_alpha() -> None:
    """边缘透明且主体占比合理时应直接信任真实 Alpha，不重复键色抠除。"""

    class NativeAlphaEnhancer:
        name = "test-alpha"
        model = "test"
        prompt_version = "test"

        def enhance(
            self,
            image: Image.Image,
            *,
            options: EnhancementOptions,
        ) -> EnhancementResult:
            del image, options
            output = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
            for x in range(2, 8):
                for y in range(2, 8):
                    output.putpixel((x, y), (255, 255, 255, 255))
            return EnhancementResult(image=output)

    source = Image.new("RGBA", (10, 10), (255, 255, 255, 255))
    try:
        prepared = prepare_foreground(
            source,
            enhancer=NativeAlphaEnhancer(),
            options=_solid_options(),
        )
        try:
            assert prepared.processing == "native_alpha"
            assert prepared.image.getpixel((5, 5))[3] == 255
            assert prepared.image.getpixel((0, 0))[3] == 0
        finally:
            prepared.image.close()
    finally:
        source.close()


def test_prepare_foreground_removes_drifted_chroma_spill_from_subject_edge() -> None:
    """键背景漂移并混入轮廓时，不应留下可计豆的青绿色边缘。"""
    source = Image.new("RGBA", (9, 9), (245, 245, 245, 255))
    try:
        prepared = prepare_foreground(
            source,
            enhancer=_ChromaSpillEnhancer(),
            options=_solid_options(),
        )
        try:
            assert prepared.processing == "chroma_key"
            assert prepared.image.getpixel((4, 4))[3] == 255
            assert all(
                prepared.image.getpixel((x, y))[3] < 128
                for x in range(2, 7)
                for y in range(2, 7)
                if x in (2, 6) or y in (2, 6)
            )
        finally:
            prepared.image.close()
    finally:
        source.close()
