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
  const dotted = DOTTED_MULTIPLIERS[rhythm.dots];
  const numerator =
    BASE_DURATION_TICKS[rhythm.base] *
    dotted.numerator *
    (tuplet?.normalNotes ?? 1);
  const denominator = dotted.denominator * (tuplet?.actualNotes ?? 1);

  if (numerator % denominator !== 0) {
    return { ok: false, code: "NON_INTEGER_RHYTHM_TICKS" };
  }

  return { ok: true, ticks: numerator / denominator };
};

/** 根据拍号计算一个完整小节应容纳的 tick 数。 */
export const getMeasureCapacityTicks = (timeSignature: TimeSignature): number =>
  (TICKS_PER_QUARTER * 4 * timeSignature.numerator) / timeSignature.denominator;
