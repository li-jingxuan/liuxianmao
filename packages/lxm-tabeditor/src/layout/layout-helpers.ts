import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
} from "../core/rhythm";
import type {
  Beat,
  Measure,
  TimeSignature,
  TupletGroup,
} from "../core/schema";
import {
  MEASURE_PADDING_X,
  STAFF_HEIGHT,
  STAFF_TOP,
  STRING_SPACING,
} from "./layout-constants";
import type { LayoutBounds } from "./layout-types";

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

/**
 * 将小节内 tick 映射为 SVG x 坐标。
 *
 * 关键公式：
 * 1. usableWidth = 小节宽度 - 左右留白
 * 2. progress = beat.tick / 小节容量 tick
 * 3. x = 小节左边界 + 左留白 + usableWidth * progress
 *
 * clamp(progress, 0, 1) 可以防止非法或临界数据把元素画到小节外。
 */
export const getBeatX = (
  measureX: number,
  measureWidth: number,
  tick: number,
  capacityTicks: number,
): number => {
  const usableWidth = measureWidth - MEASURE_PADDING_X * 2;
  const progress = capacityTicks > 0 ? tick / capacityTicks : 0;

  return measureX + MEASURE_PADDING_X + usableWidth * clamp(progress, 0, 1);
};

/** 休止符放在六线谱垂直中线附近，后续可按具体休止符类型细调 y。 */
export const getRestY = (measureY: number): number =>
  measureY + STAFF_TOP + STAFF_HEIGHT / 2;

export const containsPoint = (
  bounds: LayoutBounds,
  x: number,
  y: number,
): boolean =>
  x >= bounds.x &&
  x <= bounds.x + bounds.width &&
  y >= bounds.y &&
  y <= bounds.y + bounds.height;
