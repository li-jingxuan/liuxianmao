/** 统一保护明确内容、重排实际 tick，并精确协调尾部容量休止。 */
import { createMeasureRhythmContext } from "./tuplet";
import { getMeasureCapacityTicks } from "./rhythm";
import { createRestBeats } from "./rest-beats";
import type { ILXMMeasure } from "./types";

/** 分组休止和被编辑的休止也属于明确内容，只消费其后的普通尾部休止。 */
export const getFixedPrefixLength = (
  measure: ILXMMeasure,
  protectedBeatIds: ReadonlySet<string> = new Set(),
) => {
  const context = createMeasureRhythmContext(measure);
  let length = measure.beats.length;
  while (length > 0) {
    const beat = measure.beats[length - 1]!;
    if (
      beat.kind !== "rest" ||
      context.tupletByBeatId.has(beat.id) ||
      protectedBeatIds.has(beat.id)
    )
      break;
    length -= 1;
  }
  return length;
};
export type MeasureTimelineResult =
  | { ok: true; measure: ILXMMeasure }
  | { ok: false; code: "MEASURE_OVERFLOW" | "RHYTHM_NOT_REPRESENTABLE" };
export const reconcileMeasureTimeline = (
  measure: ILXMMeasure,
  options: {
    createBeatId: () => string;
    protectedBeatIds?: ReadonlySet<string>;
  },
): MeasureTimelineResult => {
  const context = createMeasureRhythmContext(measure);
  const prefixLength = getFixedPrefixLength(measure, options.protectedBeatIds);
  let tick = 0;
  const prefix = [];
  for (const beat of measure.beats.slice(0, prefixLength)) {
    const duration = context.getBeatDurationTicks(beat);
    if (!duration.ok) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
    prefix.push(beat.tick === tick ? beat : { ...beat, tick });
    tick += duration.ticks;
  }
  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  if (tick > capacity) return { ok: false, code: "MEASURE_OVERFLOW" };
  // 原尾部已经精确匹配时保留 ID 与对象引用，避免无关引用失效。
  const tail = measure.beats.slice(prefixLength);
  let expected = tick;
  const unchangedTail =
    tail.every((beat) => {
      const duration = context.getBeatDurationTicks(beat);
      if (!duration.ok || beat.tick !== expected) return false;
      expected += duration.ticks;
      return true;
    }) && expected === capacity;
  const rests = unchangedTail
    ? tail
    : createRestBeats(tick, capacity - tick, options.createBeatId);
  if (!rests) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
  return { ok: true, measure: { ...measure, beats: [...prefix, ...rests] } };
};
