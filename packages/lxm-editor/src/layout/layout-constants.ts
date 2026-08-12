/**
 * Layout 几何常量模块。
 *
 * 这个模块用于集中维护六线谱排版需要的尺寸、间距、最小宽度和视觉权重，
 * 避免魔法数字散落在小节布局、节奏列布局和整谱布局算法中。后续实现时，
 * 所有影响布局观感的固定数值应优先放在这里。
 */

import { GUITAR_STRING_COUNT } from "../core/constants";
import type { ILXMLayoutDensity } from "./layout-types";

// 谱面布局默认位置
export const LXM_LAYOUT_DEFAULT_X = 0;
export const LXM_LAYOUT_DEFAULT_Y = 0;

/** 单条谱面行默认可容纳的逻辑宽度；由调用方可通过 systemWidth 覆盖。 */
export const LXM_SYSTEM_DEFAULT_WIDTH = 600;

/** 相邻两条谱面行之间的垂直留白，避免符干、连梁发生视觉重叠。 */
export const LXM_SYSTEM_GAP_Y = 36;

/**
 * system 上方技巧区的确定性尺寸。
 *
 * 每条 lane 容纳一条弧线/文本线；水平区间相交的技巧会被分到不同 lane。额外
 * padding 让最靠近 staff 的 lane 与第一弦之间仍有清晰净空。
 */
export const LXM_TECHNIQUE_LANE_HEIGHT = 14;
export const LXM_TECHNIQUE_AREA_PADDING_TOP = 4;
export const LXM_TECHNIQUE_AREA_PADDING_BOTTOM = 6;
export const LXM_TECHNIQUE_HORIZONTAL_CLEARANCE = 6;
export const LXM_TECHNIQUE_TEXT_FONT_SIZE = 10;
export const LXM_TECHNIQUE_PATH_STROKE_WIDTH = 1.2;
export const LXM_TECHNIQUE_HIT_PADDING = 4;

/**
 * 每条谱面行左侧的纵向 TAB 谱号列宽。
 *
 * 这里仍需保留一列很窄的几何宽度，避免拍号和第一拍压住字母；但六根弦线会贯穿
 * 整列，因此它不再表现为六线谱正文之前的一块空白区域。
 */
export const LXM_SYSTEM_HEADER_WIDTH = 22;

/** 纵向 T/A/B 使用同一字号与水平中心，三个基线分别落在六线谱上、中、下部。 */
export const LXM_TAB_LABEL_FONT_SIZE = 11;
export const LXM_TAB_LABEL_CENTER_OFFSET_X = 10;
export const LXM_TAB_LABEL_BASELINE_OFFSETS_Y = [10, 30, 50] as const;

/**
 * 拍号是小节的固定前导记号，不随节奏列一起拉伸。
 * width 同时覆盖两位数分子/分母与拍号右侧净空。
 */
export const LXM_TIME_SIGNATURE_WIDTH = 24;
export const LXM_TIME_SIGNATURE_FONT_SIZE = 14;
export const LXM_TIME_SIGNATURE_NUMERATOR_OFFSET_Y = 22;
export const LXM_TIME_SIGNATURE_DENOMINATOR_OFFSET_Y = 48;

/**
 * 开始反复线的圆点会向右伸入下一小节。下一小节的拍号和第一拍必须额外后移，
 * 不能只依赖 compact 模式 8px padding，否则圆点会与拍号数字落在同一位置。
 */
export const LXM_LEADING_REPEAT_CLEARANCE_WIDTH = 12;

/**
 * 稀疏 System 的节奏内容区最大横向拉伸倍数。
 *
 * 该限制用于所有末行以及任意位置的单小节行。倍数只作用于 beat columns 的内容
 * 宽度；小节左右 padding 与 measureGap 都保持固定，避免通过放大空白伪造舒展感。
 * 当按此倍数计算出的宽度足以覆盖完整行宽时，System 仍会自然铺满。
 */
export const LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE = 1.6;

/** 默认排版密度保持 MVP v1-v3 既有页面和核心测试的几何结果。 */
export const LXM_LAYOUT_DEFAULT_DENSITY: ILXMLayoutDensity = "comfortable";

/**
 * 横向排版 profile 只供核心 layout implementation 使用。
 *
 * 网站只选择 density，不感知列宽缩放、最低可读宽度和小节 padding 的组合规则。
 */
export const LXM_LAYOUT_DENSITY_PROFILES = {
  comfortable: {
    measurePaddingX: 18,
    idealColumnScale: 1,
    minColumnWidth: null,
  },
  compact: {
    // A4 紧凑契约与既有几何测试均以 8px 为基线；12px 会把规范八小节
    // 从 4+4 挤成 3+5，并让第二行命中目标整体漂移。
    measurePaddingX: 8,
    // v4.1 把 TAB 行头、首次拍号和反复线净空纳入同一 A4 内容宽度。0.34 在不
    // 突破 15px 最低列宽的前提下，仍能让既有八小节规范谱保持每行四小节。
    idealColumnScale: 0.34,
    minColumnWidth: 15,
  },
} as const satisfies Record<
  ILXMLayoutDensity,
  {
    measurePaddingX: number;
    idealColumnScale: number;
    minColumnWidth: number | null;
  }
>;

/** 点击弦线时允许的纵向误差范围，提升鼠标命中容错。 */
export const LXM_STRING_HIT_RADIUS_Y = 6;

/**
 * TAB 当前活动输入框的固定逻辑尺寸。
 *
 * caret 是精确表达当前 Beat/string 输入位置的视觉标记，不应随节奏列宽度、
 * System 拉伸或命中容错区域一起变化。20 × 14 能完整包围当前一位/两位品位文本，
 * 并在 12px 弦距上下各保留 1 个逻辑单位的视觉空隙。
 */
export const LXM_TAB_FOCUS_CARET_WIDTH = 20;
export const LXM_TAB_FOCUS_CARET_HEIGHT = 14;

// 左右留白距离
export const LXM_MEASURE_PADDING_X =
  LXM_LAYOUT_DENSITY_PROFILES.comfortable.measurePaddingX;

// 第一弦和第六弦上下留白距离
export const LXM_STAFF_Y = 28;

// 小节最小宽度
export const LXM_MEASURE_MIN_WIDTH = 112;

// 每根弦之间的间距
export const LXM_STRING_SPACING = 12;

// 六线谱的高度
export const LXM_STAFF_HEIGHT = LXM_STRING_SPACING * (GUITAR_STRING_COUNT - 1);

/** 节奏符号行相对第六弦向下的距离；所有 beat 共享同一条水平基线。 */
export const LXM_DURATION_HEAD_OFFSET_Y = 10;

/** Bravura 节奏头字号；由核心 layout 返回给渲染层，避免页面写魔法数字。 */
export const LXM_DURATION_HEAD_FONT_SIZE = 16;

/** 符干从和弦中画面最靠下音符继续向下延伸时的垂直间距。 */
export const LXM_DURATION_STEM_NOTE_GAP = 6;

/** 节奏头到连梁/旗帜锚点之间的固定符干长度。 */
export const LXM_DURATION_STEM_LENGTH = 28;

/** 延续占位线的视觉宽度；精确坐标由 beat slot 的四分单位宽度决定。 */
export const LXM_DURATION_SUSTAIN_WIDTH = 10;

/** 延续占位线允许的最小可读宽度。 */
export const LXM_DURATION_SUSTAIN_MIN_WIDTH = 4;

/** 延续占位线与所属四分单位边界之间至少保留的水平空隙。 */
export const LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING = 2;

/** 延续占位线线宽及其相对六线谱垂直中线的视觉校准值。 */
export const LXM_DURATION_SUSTAIN_THICKNESS = 1;
export const LXM_DURATION_SUSTAIN_OFFSET_Y = 0;

/** 附点与最高连梁（或无连梁时的 rhythm lane）之间的垂直净空。 */
export const LXM_DURATION_DOT_CLEARANCE_Y = 5;

/** Bravura 孤立短时值旗帜字号。 */
export const LXM_DURATION_FLAG_FONT_SIZE = 18;

/** 旗帜字形原点相对符干终点的校准值，集中保留供浏览器视觉验收调整。 */
export const LXM_DURATION_FLAG_OFFSET_X = 0;
export const LXM_DURATION_FLAG_OFFSET_Y = 0;

/**
 * Bravura 向下旗帜从 SVG text 原点向下延伸的最大视觉距离。
 *
 * 字体的 glyph bounding box 明显大于 CSS font-size，不能直接拿 18px 字号代替；
 * 此值由目标浏览器中三十二分旗帜的实际包围框向上取整得到。
 */
export const LXM_DURATION_FLAG_DESCENT = 36;

/** rhythm lane 最下方额外留白，避免字形被 SVG viewBox 裁切。 */
export const LXM_DURATION_LANE_BOTTOM_PADDING = 12;

// 小节线细线宽度
export const LXM_BARLINE_THIN_STROKE_WIDTH = 1;

// 小节线粗线宽度
export const LXM_BARLINE_THICK_STROKE_WIDTH = 3;

// 复合小节线中相邻竖线的横向间距
export const LXM_BARLINE_LINE_GAP = 4;

// 反复小节线圆点半径
export const LXM_BARLINE_REPEAT_DOT_RADIUS = 2;

// 反复小节线圆点与基准竖线的横向距离
export const LXM_BARLINE_REPEAT_DOT_OFFSET_X = 8;

// 反复小节线上方圆点相对第一弦的纵向偏移
export const LXM_BARLINE_REPEAT_UPPER_DOT_OFFSET_Y = LXM_STRING_SPACING * 1.5;

// 反复小节线下方圆点相对第一弦的纵向偏移
export const LXM_BARLINE_REPEAT_LOWER_DOT_OFFSET_Y = LXM_STRING_SPACING * 3.5;

/** 不同时值的视觉权重只影响横向距离，不改变音乐 tick。 */
export const LXM_DURATION_VISUAL_WEIGHT = {
  whole: 4,
  half: 3,
  quarter: 2.2,
  eighth: 1.45,
  sixteenth: 1,
  thirtySecond: 0.72,
} as const;

/** 每种时值最低列宽，保证短时值仍可读。 */
export const LXM_DURATION_MIN_COLUMN_WIDTH = {
  whole: 54,
  half: 44,
  quarter: 34,
  eighth: 24,
  sixteenth: 17,
  thirtySecond: 12,
} as const;
