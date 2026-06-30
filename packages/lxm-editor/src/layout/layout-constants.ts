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

// 小节之间隔多远
export const LXM_MEASURE_GAP = 12;

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
