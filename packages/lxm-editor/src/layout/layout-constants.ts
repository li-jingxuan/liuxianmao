/**
 * Layout 几何常量模块。
 *
 * 这个模块用于集中维护六线谱排版需要的尺寸、间距、最小宽度和视觉权重，
 * 避免魔法数字散落在小节布局、节奏列布局和整谱布局算法中。后续实现时，
 * 所有影响布局观感的固定数值应优先放在这里。
 */

import { GUITAR_STRING_COUNT } from "../core/constants";

// 谱面布局默认位置
export const LXM_LAYOUT_DEFAULT_X = 0;
export const LXM_LAYOUT_DEFAULT_Y = 0;

/** 单条谱面行默认可容纳的逻辑宽度；由调用方可通过 systemWidth 覆盖。 */
export const LXM_SYSTEM_DEFAULT_WIDTH = 600;

/** 相邻两条谱面行之间的垂直留白，避免符干、连梁发生视觉重叠。 */
export const LXM_SYSTEM_GAP_Y = 36;

/** 点击弦线时允许的纵向误差范围，提升鼠标命中容错。 */
export const LXM_STRING_HIT_RADIUS_Y = 6;

// 左右留白距离
export const LXM_MEASURE_PADDING_X = 18;

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
export const LXM_DURATION_DOT_CLEARANCE_Y = 4;

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
