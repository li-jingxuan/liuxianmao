import { TICKS_PER_QUARTER } from "./constants";
import type { RhythmValue, TimeSignature, TupletGroup } from "./schema";

/** 基础时值统一换算为整数 tick。 */
export const BASE_DURATION_TICKS = {
  whole: TICKS_PER_QUARTER * 4,
  half: TICKS_PER_QUARTER * 2,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  sixteenth: TICKS_PER_QUARTER / 4,
  thirtySecond: TICKS_PER_QUARTER / 8,
} as const;

const DOTTED_MULTIPLIERS = {
  0: { numerator: 1, denominator: 1 },
  1: { numerator: 3, denominator: 2 },
  2: { numerator: 7, denominator: 4 },
} as const;

export type RhythmTickResult =
  | { ok: true; ticks: number }
  | { ok: false; code: "NON_INTEGER_RHYTHM_TICKS" };

/**
 * 使用有理数一次性计算附点与连音倍率，最后才做整除判断，避免浮点误差。
 */
export const calculateRhythmTicks = (
  rhythm: RhythmValue,
  tuplet?: Pick<TupletGroup, "actualNotes" | "normalNotes">,
): RhythmTickResult => {
  // 附点时值使用分数表达：
  // - 无附点 = 1/1
  // - 单附点 = 3/2
  // - 双附点 = 7/4
  const dotted = DOTTED_MULTIPLIERS[rhythm.dots];

  // 最终 tick = 基础时值 × 附点倍率 × 连音倍率。
  // 这里把所有倍率都保留为“分子 / 分母”的形式统一计算：
  // - BASE_DURATION_TICKS[rhythm.base] 是基础音符对应的整数 tick
  // - dotted.numerator / dotted.denominator 是附点倍率
  // - normalNotes / actualNotes 是连音倍率，例如三连音八分音符是 2 / 3
  const numerator =
    BASE_DURATION_TICKS[rhythm.base] *
    dotted.numerator *
    (tuplet?.normalNotes ?? 1);
  const denominator = dotted.denominator * (tuplet?.actualNotes ?? 1);

  // 内部时间轴严格使用整数 tick。
  // 如果当前节奏组合无法精确落到整数 tick 网格，就返回失败，让上层决定如何处理。
  if (numerator % denominator !== 0) {
    return { ok: false, code: "NON_INTEGER_RHYTHM_TICKS" };
  }

  return { ok: true, ticks: numerator / denominator };
};

/** 根据拍号计算一个完整小节应容纳的 tick 数。 */
export const getMeasureCapacityTicks = (timeSignature: TimeSignature): number =>
  (TICKS_PER_QUARTER * 4 * timeSignature.numerator) / timeSignature.denominator;

export interface BeatFragment {
  tick: number;
  rhythm: RhythmValue;
}

const CANONICAL_RHYTHMS: RhythmValue[] = [
  { base: "whole", dots: 0 },
  { base: "half", dots: 1 },
  { base: "half", dots: 0 },
  { base: "quarter", dots: 1 },
  { base: "quarter", dots: 0 },
  { base: "eighth", dots: 1 },
  { base: "eighth", dots: 0 },
  { base: "sixteenth", dots: 0 },
  { base: "thirtySecond", dots: 0 },
];

/**
 * 把任意 tick 区间切成 schema 能直接保存的真实 beat 片段。
 *
 * 占位网格本身不会进入 score；当用户在长 beat 内部的空 slot 输入时，
 * 命令层需要把原 beat 的前后空白区间 materialize 成真实 rest。
 * 这里采用“从当前位置能放下的最大标准时值”贪心拆分：
 * - 每个 fragment 都精确接在 cursor 上，不产生重叠或空洞；
 * - 只返回 score schema 已支持的 RhythmValue，不引入 placeholder；
 * - timeSignature 用来约束区间不能越过当前小节容量，避免生成语义非法片段。
 */
export const partitionTickRangeToRhythms = (
  startTick: number,
  endTick: number,
  timeSignature: TimeSignature,
): BeatFragment[] => {
  const capacityTicks = getMeasureCapacityTicks(timeSignature);
  if (startTick < 0 || endTick < startTick || endTick > capacityTicks) {
    throw new Error(`无法把 ${startTick}-${endTick} 切成合法节奏片段`);
  }

  const fragments: BeatFragment[] = [];
  let cursor = startTick;

  while (cursor < endTick) {
    const next = CANONICAL_RHYTHMS.find((rhythm) => {
      const result = calculateRhythmTicks(rhythm);
      return result.ok && cursor + result.ticks <= endTick;
    });

    if (!next) {
      throw new Error(`无法把 ${startTick}-${endTick} 切成合法节奏片段`);
    }

    const ticksResult = calculateRhythmTicks(next);
    if (!ticksResult.ok) {
      throw new Error(`无法把 ${startTick}-${endTick} 切成合法节奏片段`);
    }

    fragments.push({ tick: cursor, rhythm: next });
    cursor += ticksResult.ticks;
  }

  return fragments;
};
