"""Seedream 5.0 lite 的网格与颜色预算感知中文拼豆预处理提示词。"""

from __future__ import annotations

import re

from pindou.core.errors import ApiError
from pindou.imaging.color_budget import (
    ColorBudgetBand,
    GridDetailBand,
    classify_grid_detail,
)
from pindou.schemas.conversion import BackgroundMode, ConversionStyle
from pindou.services.enhancer import EnhancementOptions

DEFAULT_SOLID_BACKGROUND_COLOR = "#FFFFFF"
HEX_COLOR_PATTERN = re.compile(r"#[0-9A-Fa-f]{6}")
# Prompt 内容与版本号必须在同一模块内同步变更，避免环境变量把实际实现标成旧版。
SEEDREAM_PROMPT_VERSION = "seedream-pindou-v10-conversion-style"

BASE_PROMPT = """
以输入图为唯一内容依据。保留主体身份、类别、数量、姿态、朝向、标志性轮廓、主要配色、关键身份色和整体场景语义，不改变原图的核心内容。
只做后续缩小和有限色卡量化所必需的归纳与边界整理，不主动增加细节、装饰、纹理或新的视觉重点。
将图像整理为主体轮廓清楚、主要色块连续、视觉层级稳定的平面插画中间图。
优先保证主体整体可识别，再保留少量有身份意义的内部特征；次要局部和背景细节可以合并或弱化。
""".strip()

CHIBI_STYLE_PROMPT = """
主体风格：将前景主体转换为清晰、可爱、圆润的 Q 版平面插画表达。
人物或拟人角色使用约 2–3 头身的大头小身体比例，适度放大最有身份意义的面部特征，
简化四肢、服饰褶皱和次要配件；非人物主体也使用圆润、紧凑、低细节的可爱化比例。
保留主体身份、类别、数量、朝向、动作、主要配色、标志性服饰或结构，以及主体之间的关系。
比例变化不能造成肢体缺失、主体粘连、遮挡关系颠倒或构图重心明显偏移。
""".strip()

STICKER_STYLE_PROMPT = """
主体风格：将主体转换为轮廓醒目、色彩鲜明、形体紧凑的贴纸插画表达。
使用粗细稳定的单层深色外轮廓和少量必要内部线条，色块平坦、封闭、连续，主体与背景清楚分离。
保留主体身份、数量、姿态、主要配色和标志性结构，不增加文字、标志或装饰。
不要生成白色裁切边、离型纸、包装、投影、翘边、反光或贴在物体表面的展示场景。
""".strip()

MINIMAL_ILLUSTRATION_STYLE_PROMPT = """
主体风格：将画面主动归纳为简约现代的平面插画。
使用简洁几何形体、克制的封闭轮廓和少量连续大色块，合并次要结构、重复装饰、纹理和细碎明暗。
保留主体身份、类别、数量、动作、主要配色、关键识别特征和构图关系；简化不等于删除主体或改变语义。
不要生成渐变、颗粒、笔触、复杂光影或装饰性小图形。
""".strip()

PAPER_CUT_STYLE_PROMPT = """
主体风格：将画面转换为彩色剪纸插画，使用少量完整纸片形状表达主体结构和必要空间层次。
所有纸片使用清晰封闭的硬边界、连续纯色色块和克制的前后分层，保留主体身份、数量、姿态、主要配色和构图。
不要生成纸张纤维、毛边、褶皱、卷曲、密集镂空、真实投影、桌面摆拍或立体手工作品照片。
不要让纸片分层改变主体数量、肢体完整性和遮挡关系。
""".strip()

STYLE_PROMPTS: dict[ConversionStyle, str | None] = {
    ConversionStyle.ORIGINAL: None,
    ConversionStyle.CHIBI: CHIBI_STYLE_PROMPT,
    ConversionStyle.STICKER: STICKER_STYLE_PROMPT,
    ConversionStyle.MINIMAL_ILLUSTRATION: MINIMAL_ILLUSTRATION_STYLE_PROMPT,
    ConversionStyle.PAPER_CUT: PAPER_CUT_STYLE_PROMPT,
}

GRID_DETAIL_PROMPTS: dict[GridDetailBand, str] = {
    GridDetailBand.MICRO: """
细节等级：极低分辨率图标化表达。
使用非常简洁、稳定的外轮廓和少量大面积色块；显著加强主体与相邻区域的明度或色相区分。
只保留最能识别主体的 2–4 个内部特征，合并细小五官、毛发、褶皱、纹理、反光和重复装饰。
删除独立小亮点、细线、狭长色带和缩小后会消失的孤立区域。阴影最多保留一层宽而连续的形体阴影。
""".strip(),
    GridDetailBand.SMALL: """
细节策略：主体轮廓优先（52×52 预设档）。
把主要视觉预算集中在主体外轮廓、姿态、头身大形和主要结构分区。
先保证主体整体一眼可识别，再保留最有身份意义的 2–4 个内部特征。
合并细小五官、发丝、褶皱、纹理、反光、重复装饰和零碎配件，不要逐项强调原图中的所有局部。细肢体、尾巴、把手或连接结构只在防止断裂时做必要加粗，不得借此扩充细节。
预计缩小后只能形成单个零散采样点的特征，应删除或并入相邻结构。光影最多保留固有色、一个主要亮面和一个主要暗面，避免细碎明暗。
结果应以稳定、连续、清楚的主体轮廓为第一目标，内部信息宁少勿碎。
""".strip(),
    GridDetailBand.MEDIUM: """
细节策略：主体结构优先（78×78 预设档）。
按“主体外轮廓与姿态、主要结构分区、少量身份特征、次要装饰”的顺序分配细节。完整保留主体大形和关键内部关系，但不要让五官、配件、材质和花纹同时成为视觉重点。
保留主要表情关系、服饰分区、动物主花色或物体功能结构；将次要配件、重复图案、细发丝、摄影纹理、细碎反光和柔和渐变合并为稳定色块。
容易断裂或粘连的结构可以做必要的轮廓整理和对比分离，但不主动放大局部特征。使用两到三层主要明暗，避免高频边缘和零散强调色。
结果应先读出主体轮廓和姿态，再读出少量关键内部结构，而不是同时展示大量细节。
""".strip(),
    GridDetailBand.LARGE: """
细节策略：较高网格的克制保留（104×104 预设档）。
保留完整主体结构、主要五官和表情、服饰或物体的关键构造、识别性图案、重要材质分区和主要空间层次，但不要原样复制摄影画面的全部频率。
先保证主体轮廓和主要结构之间的分界，再保留有身份意义的局部。面积过小、对比不足或容易粘连的特征只做必要整理，不主动放大或增加视觉权重。
将毛孔、颗粒、杂乱发丝、细碎反光、无规律纹理和连续渐变归并为有方向、有层级的平面形体。允许保留三到四层有意义的明暗或材质变化，但每一层都应形成面积足够、边界稳定的区域。
结果可以比低网格保留更多细节，但仍应避免照片式复刻和无重点的细节堆积。
""".strip(),
}

SUBJECT_FIRST_PROMPT = """
当前网格小于 104×104，主体是唯一视觉重点。
主体外轮廓的连续性和可辨识度高于内部细节、背景层次和装饰完整度。
将背景限制为场景识别所需的少量大区域，使用比主体更少、更大、对比更弱的色块；合并背景物体内部纹理、重复结构、细碎边缘、光影和装饰，不新增高对比背景细节。
按照当前背景模式决定背景物体能否删除：保留背景时维持有语义物体的类别、数量、位置和遮挡关系，但降低其内部细节；简化背景时可继续删除低价值物体。
不得因为背景丰富或局部精致而牺牲主体轮廓、姿态和主要结构分区。
""".strip()

COLOR_BUDGET_PROMPTS: dict[ColorBudgetBand, str] = {
    ColorBudgetBand.RESTRAINED: """
颜色预算：受限。
同一结构只使用一到两个必要颜色层级，以固有色为主，最多保留一个主要亮面或暗面。
将视觉相近、承担相同结构语义的颜色主动合并为连续区域，删除孤立颜色、细碎高光、抗锯齿过渡色和渐变中间色。
优先保证主体身份色和主体与背景的对比，不追求颜色数量。
""".strip(),
    ColorBudgetBand.BALANCED: """
颜色预算：平衡。
保留主体主要配色、关键身份色和少量有意义的强调色；同一结构最多使用固有色、主要亮面、主要暗面三个层级。
合并无识别价值的近似色、摄影渐变、抗锯齿过渡色和微弱光照变化；每种颜色必须形成面积足够、边界连续的区域。
""".strip(),
    ColorBudgetBand.RICH: """
颜色预算：丰富但受控。
保留有助于识别主体的色相差异、主要材质分区、局部强调色和必要明暗层次，但同一结构最多保留三到四个有明确形体作用的颜色层级。
合并肉眼难以区分、承担相同结构语义的近似色，以及细碎反光、噪点色、抗锯齿过渡色和无规律渐变。
""".strip(),
}

OUTLINE_PROMPT = """
轮廓与线条策略：
主体外轮廓必须稳定、连续，并与相邻区域具有明显的明度或色相差异；不要用多条不同深浅的近似颜色模拟同一条轮廓。
关键外轮廓在缩小后应覆盖至少约 1.5 个目标采样单元；决定身份的内部线条至少覆盖约 1 个目标采样单元。
预计缩小后不足一个采样单元的线条，应加粗为连续结构，或在不影响主体身份时删除并入相邻色块。
不要为轮廓、阴影或色块边缘生成抗锯齿色带、柔和渐变和重复描边。
""".strip()

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
        "背景处理：突出所有主要前景主体及其完整轮廓、内部特征和自然边缘，删除无关小物体、"
        "复杂纹理和抢占视觉注意力的背景元素。\n"
        "主体与背景必须有清晰边界，但不要生成键色、透明通道、荧光描边或特殊抠图协议；"
        "后续程序会使用本地前景模型生成蒙版。\n"
        "背景应简洁、平坦、低细节，并与主体主要颜色保持足够对比；不要让背景颜色反射、"
        "辉光或色溢混入主体边缘。\n"
        "不要生成地平线、边框、投影或渐变，不要删除、裁断或重绘主体结构。"
    )


def normalize_background_color(value: str | None) -> str:
    """纯色未指定时使用纯白，并只允许标准 HEX 进入 Prompt 和图像处理。"""
    if value is None:
        return DEFAULT_SOLID_BACKGROUND_COLOR
    if HEX_COLOR_PATTERN.fullmatch(value) is None:
        raise ApiError(400, "BACKGROUND_COLOR_INVALID", "背景颜色必须为 #RRGGBB")
    return value.upper()


def build_seedream_prompt(options: EnhancementOptions) -> str:
    """按转换类型、网格、颜色预算和背景模式组装 Prompt。"""
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
    prompt_parts = [BASE_PROMPT]
    style_prompt = STYLE_PROMPTS[options.conversion_style]
    if style_prompt is not None:
        prompt_parts.append(style_prompt)
    prompt_parts.extend((grid_context, GRID_DETAIL_PROMPTS[detail_band], OUTLINE_PROMPT))
    if options.grid_size < 104:
        prompt_parts.append(SUBJECT_FIRST_PROMPT)
    prompt_parts.extend(
        (
            color_budget_context,
            COLOR_BUDGET_PROMPTS[options.color_budget_band],
            _build_background_prompt(options),
            OUTPUT_GUARD_PROMPT,
        )
    )
    return "\n\n".join(prompt_parts)
