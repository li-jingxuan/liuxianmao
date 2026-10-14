import { LXM_RHYTHM_BASES } from "./constants";
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import { createNumberedRhythmContext } from "./numbered-rhythm";
import type { ILXMMeasure, ILXMRhythm } from "./types";

const rhythms = LXM_RHYTHM_BASES.flatMap((base) =>
  [0, 1, 2].map((dots) => {
    const rhythm = { base, dots },
      duration = calculateRhythmTicks(rhythm);
    return { rhythm, ticks: duration.ok ? duration.ticks : 0 };
  }),
)
  .filter((r) => r.ticks > 0)
  .sort((a, b) => b.ticks - a.ticks);

/** 精确时长优先使用无附点写法，不把半拍空位默认解释为四分音。 */
export const numberedRhythmForTicks = (ticks: number): ILXMRhythm | undefined =>
  rhythms.find((r) => r.ticks === ticks)?.rhythm;

export interface NumberedInputRange {
  startTick: number;
  endTick: number;
  rhythm?: ILXMRhythm;
  eventId?: string;
}

/** 从独立声部的完整占用区间求空白；Tuplet gap 保留成员身份，不生成假 Beat。 */
export const planNumberedInputRanges = (
  measure: ILXMMeasure,
): NumberedInputRange[] => {
  const result: NumberedInputRange[] = [],
    context = createNumberedRhythmContext(measure.numberedVoice);
  const unit = 3840 / measure.timeSignature.denominator;
  const appendBlank = (start: number, end: number) => {
    let cursor = start;
    while (cursor < end) {
      const boundary = Math.min(end, (Math.floor(cursor / unit) + 1) * unit);
      const option = rhythms.find((r) => r.ticks <= boundary - cursor);
      const next = option ? cursor + option.ticks : boundary;
      result.push({
        startTick: cursor,
        endTick: next,
        ...(option ? { rhythm: { ...option.rhythm } } : {}),
      });
      cursor = next;
    }
  };
  let cursor = 0;
  for (const event of measure.numberedVoice.events) {
    const duration = context.getEventDurationTicks(event);
    if (!duration.ok) continue;
    if (cursor < event.tick) appendBlank(cursor, event.tick);
    const endTick = event.tick + duration.ticks;
    if (event.kind === "gap")
      result.push({
        eventId: event.id,
        startTick: event.tick,
        endTick,
        rhythm: { ...event.rhythm },
      });
    cursor = endTick;
  }
  appendBlank(cursor, getMeasureCapacityTicks(measure.timeSignature));
  return result;
};
