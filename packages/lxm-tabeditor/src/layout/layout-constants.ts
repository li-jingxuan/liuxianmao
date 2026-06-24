import { GUITAR_STRING_COUNT } from "../core/constants";

/**
 * layout 层几何常量。
 *
 * 这里集中维护 SVG 固定排版所依赖的尺寸、间距和基线值，避免这些“版式真值”
 * 分散在多个算法函数里。后续若要调整 720p MVP 的视觉密度，只需要改这一处。
 */

export const FIXED_SCORE_LAYOUT_WIDTH = 1040;

/**
 * 当前 MVP 只按 720p 桌面基线设计，不做响应式重排。
 * 后续如果接入真实制谱碰撞规避，可以继续在这个模块里扩展，而不影响页面渲染层。
 */
export const SYSTEM_GAP = 34;
export const SYSTEM_HEIGHT = 142;

/** system 左侧保留 TAB 前缀、拍号等行头空间，小节从这个 x 偏移后开始。 */
export const SYSTEM_HEADER_WIDTH = 88;

/** 小节内左右留白，避免 tick=0 或小节末尾的数字压到小节线。 */
export const MEASURE_PADDING_X = 18;

/** 六线谱第一根弦相对小节顶部的 y 坐标。 */
export const STAFF_TOP = 54;

/** 时值轨道放在六线谱上方，用来单独画时值头、符干和连梁，避免与品位数字打架。 */
export const DURATION_LANE_Y = STAFF_TOP + 5;

/** 连音括号与时值轨道的默认垂直关系。 */
export const TUPLET_HEIGHT = 4;
export const TUPLET_MARGIN_TOP = DURATION_LANE_Y + TUPLET_HEIGHT + 14;

/** 符干基础长度，额外的多层连梁会在此基础上继续向下延展。 */
export const DURATION_STEM_LENGTH = 14;

/** 多层符尾或多层连梁之间的垂直间距。 */
export const DURATION_LEVEL_GAP = 6;
/** 附点相对时值头锚点的水平偏移，统一由 layout 输出给渲染层消费。 */
export const DURATION_DOT_X_OFFSET = 7;
/** 附点相对时值头锚点的垂直偏移，避免跟多层符尾/连梁共用 Y 轴。 */
export const DURATION_DOT_Y_OFFSET = 5;

/** 不同时值在水平排版中的光学权重；它只影响视觉距离，不改变真实 tick。 */
export const DURATION_VISUAL_WEIGHT = {
  whole: 4,
  half: 3,
  quarter: 2.2,
  eighth: 1.45,
  sixteenth: 1,
  thirtySecond: 0.72,
} as const;

/** 每种时值对应的最小列宽，避免短时值被压缩到不可读。 */
export const DURATION_MIN_COLUMN_WIDTH = {
  whole: 54,
  half: 44,
  quarter: 34,
  eighth: 24,
  sixteenth: 17,
  thirtySecond: 12,
} as const;

/** 小节左右视觉缓冲，用于把列宽汇总成理想小节宽度。 */
export const MEASURE_IDEAL_WIDTH_PADDING = 36;
/** 小节最低宽度，保证小节线、拍号和命中区域仍有可读空间。 */
export const MEASURE_MIN_WIDTH = 112;

/** 相邻弦线的垂直间距；六条弦实际高度为 5 个间距。 */
export const STRING_SPACING = 11;
export const STRING_LINE_WIDTH = 1;
export const STAFF_HEIGHT = STRING_SPACING * (GUITAR_STRING_COUNT - 1);

/** 命中区域比视觉图形略大，下一迭代点击定位时更容易命中音符或拍点。 */
export const HIT_PADDING = 8;
