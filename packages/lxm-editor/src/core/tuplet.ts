/** 连音比例与实际时长的唯一来源；每小节建立一次索引，多次查询。 */
import { LXM_TUPLET_RATIOS } from "./constants";
import { calculateRhythmTicks } from "./rhythm";
import type {
  ILXMBeat,
  ILXMMeasure,
  ILXMTupletRatio,
  ILXMTuplet,
} from "./types";

export const isSameTupletRatio = (a: ILXMTupletRatio, b: ILXMTupletRatio) =>
  a.actual === b.actual && a.normal === b.normal;
export const isSupportedTupletRatio = (ratio: ILXMTupletRatio) =>
  LXM_TUPLET_RATIOS.some((value) => isSameTupletRatio(value, ratio));
export type BeatDurationResult =
  | { ok: true; ticks: number }
  | { ok: false; code: "INVALID_RHYTHM" | "NON_INTEGER_TUPLET_TICKS" };

export const createMeasureRhythmContext = (measure: ILXMMeasure) => {
  const tupletById = new Map<string, ILXMTuplet>();
  const tupletByBeatId = new Map<string, ILXMTuplet>();
  measure.tuplets.forEach((group) => {
    tupletById.set(group.id, group);
    group.beatIds.forEach((id) => tupletByBeatId.set(id, group));
  });
  /** 先计算附点书写时值，再用整数整除校验比例，绝不舍入。 */
  const getBeatDurationTicks = (beat: ILXMBeat): BeatDurationResult => {
    const written = calculateRhythmTicks(beat.rhythm);
    if (!written.ok) return { ok: false, code: "INVALID_RHYTHM" };
    const group = tupletByBeatId.get(beat.id);
    if (!group) return written;
    const numerator = written.ticks * group.ratio.normal;
    if (numerator % group.ratio.actual !== 0)
      return { ok: false, code: "NON_INTEGER_TUPLET_TICKS" };
    return { ok: true, ticks: numerator / group.ratio.actual };
  };
  return { tupletById, tupletByBeatId, getBeatDurationTicks };
};
export const getBeatDurationTicks = (measure: ILXMMeasure, beat: ILXMBeat) =>
  createMeasureRhythmContext(measure).getBeatDurationTicks(beat);

/** 实际结束 tick 也必须带小节上下文，避免连音组退回书写时间。 */
export const getBeatEndTick = (
  measure: ILXMMeasure,
  beat: ILXMBeat,
): BeatDurationResult => {
  const result = getBeatDurationTicks(measure, beat);
  return result.ok ? { ok: true, ticks: beat.tick + result.ticks } : result;
};
