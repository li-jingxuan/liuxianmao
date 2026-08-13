"""Seedream 5.0 lite 的中文拼豆预处理提示词。"""

from __future__ import annotations

import re

from pindou.core.errors import ApiError
from pindou.schemas.conversion import BackgroundMode
from pindou.services.enhancer import EnhancementOptions

HEX_COLOR_PATTERN = re.compile(r"#[0-9A-Fa-f]{6}")

BASE_PROMPT = """
以输入图为唯一内容依据，保留主体身份、数量、姿态、关键轮廓、主要配色和整体构图。
将图像简化为适合低分辨率拼豆图纸的平面插画中间图：使用大色块、清晰封闭边界和少量必要阴影。
去除摄影噪点、细碎纹理、反光和不必要的小装饰。
不添加新的角色、物体、文字、边框、马赛克网格、珠子质感或水印。
不改变原图的核心语义，输出一张完整图片。
""".strip()

SIMPLIFY_BACKGROUND_PROMPT = """
背景处理：保留原图的场景类型、主要背景区域和主体与背景的空间关系，但将背景大幅简化。
删除无关小物体、细碎纹理和重复线条，将相近色区域合并为少量连续大色块。
不要将背景移除或替换成单一纯色。保持主体边缘清晰，使主体与背景有足够的明度或色相对比。
""".strip()

KEEP_BACKGROUND_PROMPT = """
背景处理：保留原图背景中的场景、物体数量、相对位置、遮挡关系、主要颜色和明暗层次。
不删除、替换、虚化或改造背景内容，不把背景换成纯色。
只将背景与主体一起转换为风格统一的平面色块表达，仅去除像素级噪点和极小的摄影伪影，不改变背景语义。
""".strip()


def normalize_background_color(value: str | None) -> str:
    """只允许标准 HEX 插入提示词，避免任意文本成为 prompt 指令。"""
    if value is None or HEX_COLOR_PATTERN.fullmatch(value) is None:
        raise ApiError(400, "BACKGROUND_COLOR_INVALID", "纯色背景必须提供 #RRGGBB 颜色")
    return value.upper()


def build_seedream_prompt(options: EnhancementOptions) -> str:
    """由公共中文模板与唯一背景片段组装最终提示词。"""
    if options.background_mode is BackgroundMode.SIMPLIFY:
        background_prompt = SIMPLIFY_BACKGROUND_PROMPT
    elif options.background_mode is BackgroundMode.KEEP:
        background_prompt = KEEP_BACKGROUND_PROMPT
    else:
        color = normalize_background_color(options.background_color)
        background_prompt = (
            "背景处理：完整移除原图背景及其中所有无关物体，保留前景主体的完整轮廓、"
            "内部特征和自然边缘。\n"
            "将主体放在均匀、平坦、无渐变、无纹理、无阴影、无物体的纯色背景上。\n"
            f"背景目标颜色为 {color}。不改变主体内部原本属于该颜色的区域，"
            "不增加地面、地平线、边框或投影。"
        )
    return f"{BASE_PROMPT}\n\n{background_prompt}"
