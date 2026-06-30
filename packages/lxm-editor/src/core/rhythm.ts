/**
 * 节奏时间轴工具模块。
 *
 * 这个模块只负责把乐谱中的节奏语义转换为内部 tick 时间，不参与任何视觉宽度、
 * SVG 坐标或渲染策略计算。后续实现时应保持它是纯音乐时间层：例如四分音符
 * 等于多少 tick、附点如何换算、小节拍号对应多少 tick。
 */
import { TICKS_PER_QUARTER } from "./constants";
import type { ILXMRhythm, ILXMTimeSignature } from "./types";

// 基准节奏时值对应 tick 数
export const BASE_RHYTHM_TICKS = {
  whole: TICKS_PER_QUARTER * 4,
  half: TICKS_PER_QUARTER * 2,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  sixteenth: TICKS_PER_QUARTER / 4,
  thirtySecond: TICKS_PER_QUARTER / 8,
} as const;

// 附点音符对应的时值倍率
const DOTTED_RHYTHM_MULTIPLIERS = {
  0: { numerator: 1, denominator: 1 },
  1: { numerator: 3, denominator: 2 },
  2: { numerator: 7, denominator: 4 },
} as const;

export type RhythmTickResult =
  | { ok: true; ticks: number }
  | { ok: false; code: "UNSUPPORTED_DOTS" | "NON_INTEGER_RHYTHM_TICKS" };

/** 只计算音乐时间轴 tick，不参与任何视觉宽度决策。 */
export const calculateRhythmTicks = (rhythm: ILXMRhythm): RhythmTickResult => {
  // 附点时值使用分数表达：
  // - 无附点 = 1/1
  // - 单附点 = 3/2
  // - 双附点 = 7/4
  const dottedMultiplier =
    DOTTED_RHYTHM_MULTIPLIERS[
      rhythm.dots as keyof typeof DOTTED_RHYTHM_MULTIPLIERS
    ];

  // 不支持的附点数
  if (!dottedMultiplier) {
    return { ok: false, code: "UNSUPPORTED_DOTS" };
  }

  // 获取当前时值 tick 数量
  const numerator = BASE_RHYTHM_TICKS[rhythm.base] * dottedMultiplier.numerator;
  const denominator = dottedMultiplier.denominator;

  if (numerator % denominator !== 0) {
    return { ok: false, code: "NON_INTEGER_RHYTHM_TICKS" };
  }

  // 返回当前 Rhythm（节奏） 最终 tick 数量
  return { ok: true, ticks: numerator / denominator };
};

/** 根据拍号计算完整小节容量，4/4 等于 3840 tick。 */
export const getMeasureCapacityTicks = (
  timeSignature: ILXMTimeSignature,
): number =>
  (TICKS_PER_QUARTER * 4 * timeSignature.numerator) /
  timeSignature.denominator;