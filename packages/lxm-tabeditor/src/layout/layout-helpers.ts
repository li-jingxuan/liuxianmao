import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
} from "../core/rhythm";
import { TICKS_PER_QUARTER } from "../core/constants";
import type {
  Beat,
  TimeSignature,
  TupletGroup,
} from "../core/schema";
import {
  STAFF_HEIGHT,
  STAFF_TOP,
  STRING_SPACING,
  MEASURE_PADDING_X,
} from "./layout-constants";
import type { LayoutBounds, MeasureSpacingSummary } from "./layout-types";

/**
 * layout 层通用辅助函数。
 *
 * 这些函数不持有状态，也不直接依赖 React 或 store。它们只负责把节奏、拍点和弦号
 * 这类领域数据转换成几何基础量，供更高层的 measure/system/score 排版复用。
 */

/** 把数值限制在闭区间内，避免缩放、tick 比例或小节数量越界。 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 用函数创建 bounds，保证所有命中矩形都使用同一字段顺序。 */
export const createBounds = (
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutBounds => ({ x, y, width, height });

/**
 * 把吉他弦号映射为 y 坐标。
 *
 * 模型里的 string 从 1 开始计数，所以这里先减 1 再乘弦距。
 * 公式：y = 小节顶部 + 第一根弦偏移 + (弦号 - 1) * 弦距。
 */
export const getStringY = (measureY: number, stringIndex: number): number =>
  measureY + STAFF_TOP + (stringIndex - 1) * STRING_SPACING;

/**
 * 查找某个 beat 所属的连音组，并只返回节奏换算需要的倍率字段。
 * calculateRhythmTicks 会用 normalNotes / actualNotes 把普通时值压缩或拉伸为连音 tick。
 */
export const getBeatTuplet = (
  beatId: string,
  tuplets: TupletGroup[],
): Pick<TupletGroup, "actualNotes" | "normalNotes"> | undefined => {
  const tuplet = tuplets.find((item) => item.beatIds.includes(beatId));
  return tuplet
    ? { actualNotes: tuplet.actualNotes, normalNotes: tuplet.normalNotes }
    : undefined;
};

/**
 * 计算一个 beat 在时间轴上的真实长度。
 * 如果组合无法整除为整数 tick，前置语义校验会报错；layout 这里降级为 0，避免异常打断渲染。
 */
export const getBeatTicks = (beat: Beat, tuplets: TupletGroup[]): number => {
  const result = calculateRhythmTicks(
    beat.rhythm,
    getBeatTuplet(beat.id, tuplets),
  );
  return result.ok ? result.ticks : 0;
};

/** 小节容量是 tick 到 x 坐标映射的分母，例如 4/4 为 3840，3/4 为 2880。 */
export const getCapacityTicks = (timeSignature: TimeSignature): number =>
  getMeasureCapacityTicks(timeSignature);

/** 休止符放在六线谱垂直中线附近，后续可按具体休止符类型细调 y。 */
export const getRestY = (measureY: number): number =>
  measureY + STAFF_TOP + STAFF_HEIGHT / 2;

/**
 * 计算小节内部时间轴的左边界。
 *
 * 这里返回的是“整小节 tick 时间轴”的起点，而不是首个真实 beat 的列起点。
 * 真实 beat 仍然由 spacing.slotsByBeatId 决定视觉位置；但 edit-grid 需要让
 * 前导 gap 也能占有独立的水平空间，所以时间轴必须稳定地从小节左 padding 开始。
 */
export const getMeasureInnerLeftX = (
  _spacing: MeasureSpacingSummary,
  measureX: number,
): number => measureX + MEASURE_PADDING_X;

/**
 * 计算小节内部真正可排版的右边界。
 *
 * 这里使用 `assignedWidth - padding` 而不是最后一个 beat 的右边缘，
 * 因为尾部 gap 就是要延伸到“小节可用区域的末端”，而不是停在最后一个真实 beat 后面。
 */
export const getMeasureInnerRightX = (
  spacing: MeasureSpacingSummary,
  measureX: number,
): number => measureX + spacing.assignedWidth - MEASURE_PADDING_X;

export const containsPoint = (
  bounds: LayoutBounds,
  x: number,
  y: number,
): boolean =>
  x >= bounds.x &&
  x <= bounds.x + bounds.width &&
  y >= bounds.y &&
  y <= bounds.y + bounds.height;

/**
 * 计算一个连梁拍组对应的 tick 数。
 *
 * - 简单拍默认按分母表示的单拍分组，例如 4/4 按四分拍、3/8 按八分拍；
 * - 常见复合拍（6/8、9/8、12/8）按附点拍分组，也就是 3 个分母音符构成 1 个拍组。
 *
 * 这不是整小节容量，而是 beam grouping 用的“单个拍组宽度”。
 */
export const getBeamGroupTicks = (timeSignature: TimeSignature): number => {
  const baseBeatTicks = (TICKS_PER_QUARTER * 4) / timeSignature.denominator;

  // 6/8、9/8、12/8 这类拍号通常按 3 个八分音符为一组连梁。
  if (
    timeSignature.denominator === 8 &&
    timeSignature.numerator >= 6 &&
    timeSignature.numerator % 3 === 0
  ) {
    return baseBeatTicks * 3;
  }

  return baseBeatTicks;
};

/** 根据某个 tick 落在哪个拍组中，计算其拍组索引。 */
export const getBeatGroupIndex = (
  tick: number,
  timeSignature: TimeSignature,
): number => Math.floor(tick / getBeamGroupTicks(timeSignature));
