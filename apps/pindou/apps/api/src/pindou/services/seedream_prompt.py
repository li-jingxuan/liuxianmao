"""Seedream 5.0 lite 的网格与颜色预算感知中文拼豆预处理提示词。"""

from __future__ import annotations

from pindou.imaging.color_budget import (
    ColorBudgetBand,
    GridDetailBand,
    classify_grid_detail,
)
from pindou.schemas.conversion import BackgroundMode
from pindou.services.enhancer import EnhancementOptions

BASE_PROMPT = """
以输入图为唯一内容依据。保留主体身份、数量、姿态、朝向、关键轮廓、主要配色和整体构图，不改变原图的核心语义。
将图像整理为边界清晰、色块连续、适合后续缩小和有限色卡量化的平面插画中间图。
优先保证主体可识别性和主体与背景的分离度，再保留次要装饰。
""".strip()

GRID_DETAIL_PROMPTS: dict[GridDetailBand, str] = {
    GridDetailBand.MICRO: """
细节等级：极低分辨率图标化表达。
使用非常简洁、稳定的外轮廓和少量大面积色块；显著加强主体与相邻区域的明度或色相区分。
只保留最能识别主体的 2–4 个内部特征，合并细小五官、毛发、褶皱、纹理、反光和重复装饰。
删除独立小亮点、细线、狭长色带和缩小后会消失的孤立区域。阴影最多保留一层宽而连续的形体阴影。
""".strip(),
    GridDetailBand.SMALL: """
细节等级：低分辨率简化表达。
保持清楚的外轮廓和较大的内部结构分区，保留主要五官、服饰分区、动物花色或物体功能结构。
将相近颜色和零碎纹理合并成连续色块，移除细发丝、细小文字、密集线条、高光噪点和无识别价值的小装饰。
只使用少量必要阴影，避免窄于主要轮廓线宽的孤立细节。
""".strip(),
    GridDetailBand.MEDIUM: """
细节等级：中等分辨率平面化表达。
保留主体的关键内部结构、主要五官关系、服饰层次、材质分区和有语义价值的配件。
允许有限的局部细节和两到三层明暗，但仍将摄影纹理、细碎反光、随机噪点和重复图案归并为稳定色块。
轮廓优先于纹理，局部细节不能破坏主体边界的连续性。
""".strip(),
    GridDetailBand.LARGE: """
细节等级：较高分辨率的克制平面化表达。
保留完整的主体结构、主要五官和表情关系、服饰或物体的关键构造、具有识别意义的局部图案及主要空间层次。
可以保留适量边缘转折和明暗层次，但不要恢复照片级纹理、毛孔、颗粒、细碎反光、杂乱发丝或无规律背景噪点。
将低价值纹理合并为较大的稳定区域，确保色块边界清楚且便于有限色卡量化。
""".strip(),
}

COLOR_BUDGET_PROMPTS: dict[ColorBudgetBand, str] = {
    ColorBudgetBand.RESTRAINED: """
颜色预算：受限。
使用少量稳定主色和清楚的冷暖、明暗或色相区分，将视觉相近的颜色主动合并为连续区域。
删除只占极小面积的孤立颜色、细碎高光和渐变过渡；同一结构只保留最必要的亮面、固有色和暗面关系。
优先保证主体身份色和主体与背景的对比，不追求颜色数量。
""".strip(),
    ColorBudgetBand.BALANCED: """
颜色预算：平衡。
保留主体主要配色、关键身份色和少量有意义的强调色，合并无识别价值的近似色和摄影渐变。
允许有限的明暗层级，但每种颜色应形成面积足够、边界连续的区域，避免零散杂色。
""".strip(),
    ColorBudgetBand.RICH: """
颜色预算：丰富但受控。
保留有助于识别主体的色相差异、主要材质分区、局部强调色和必要明暗层次。
仍然合并肉眼难以区分的近似色、细碎反光、噪点色和无规律渐变。
""".strip(),
}

SIMPLIFY_BACKGROUND_PROMPT = """
背景处理：保留场景类型、主要背景区域和主体与背景的空间关系，但可以删除无关小物体、重复元素和低识别价值的装饰。
按照当前细节等级合并背景纹理和相近色区域，使背景使用比主体更少、更大的色块，并保持主体边缘具有足够对比。
不要把背景完全移除或擅自替换成单一纯色。
""".strip()

KEEP_BACKGROUND_PROMPT = """
背景处理：保留原图背景中有语义的物体、数量、相对位置、遮挡关系、主要颜色和空间层次，不删除或替换背景内容，不把背景换成纯色。
当前细节等级只控制背景物体的表达精度：可以合并物体内部纹理和微小摄影伪影，但不能删除整个有语义的背景物体或改变其类别与位置。
""".strip()

OUTPUT_GUARD_PROMPT = """
不添加输入图中不存在的角色、物体、肢体、文字、标志、边框或水印。
不要绘制像素格、马赛克方块、网格线、拼豆、珠子、十字绣或颗粒材质。
不要为了用满颜色预算而添加新颜色。
不要为了填充画面而复制主体或背景物体。输出一张构图完整的图片。
""".strip()


def _build_background_prompt(options: EnhancementOptions) -> str:
    """只选择当前背景模式的唯一片段。"""
    if options.background_mode is BackgroundMode.SIMPLIFY:
        return SIMPLIFY_BACKGROUND_PROMPT
    if options.background_mode is BackgroundMode.KEEP:
        return KEEP_BACKGROUND_PROMPT

    return (
        "背景处理：完整移除原背景及其中所有物体，保留前景主体的完整轮廓和自然边缘。\n"
        "主体外区域必须使用真实 Alpha 通道完全透明，不绘制白底、纯色底或棋盘格。\n"
        "保留主体内部原有颜色，不增加地平线、边框、投影或背景物体。"
    )


def build_seedream_prompt(options: EnhancementOptions) -> str:
    """按网格、颜色预算、背景模式和禁止项组装 Prompt v4。"""
    detail_band = classify_grid_detail(options.grid_size)
    grid_context = (
        f"这张中间图随后会被等比适配并缩小为 {options.grid_size}×{options.grid_size} "
        "个采样单元。\n"
        "让重要轮廓、身份特征和主要色块在缩小后仍然连续、清楚、可辨识。"
    )
    color_budget_context = (
        "这张中间图最终会被映射到有限的实体拼豆色卡。\n"
        "请按照当前颜色表达档位组织主要色块、强调色和明暗层级，不追求精确颜色数。"
    )
    return "\n\n".join(
        (
            BASE_PROMPT,
            grid_context,
            GRID_DETAIL_PROMPTS[detail_band],
            color_budget_context,
            COLOR_BUDGET_PROMPTS[options.color_budget_band],
            _build_background_prompt(options),
            OUTPUT_GUARD_PROMPT,
        )
    )
