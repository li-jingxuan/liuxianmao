import { LXM_RHYTHM_BASES } from "../constants";
import { calculateRhythmTicks, getMeasureDurationTicks } from "../rhythm/rhythm";
import { createNumberedRhythmContext } from "./numbered-rhythm";
import type { ILXMMeasure, ILXMRhythm } from "../types";

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
  fromTick = 0,
): NumberedInputRange[] => {
  const result: NumberedInputRange[] = [],
    context = createNumberedRhythmContext(measure.numberedVoice);
  const unit = 3840 / measure.timeSignature.denominator;
  const tabStarts = measure.beats
    .map((beat) => beat.tick)
    .sort((a, b) => a - b);
  const appendBlank = (start: number, end: number) => {
    // 延音改变前一个槽的长度后，新空白可从批量光标直接重新分解。
    let cursor = Math.max(start, fromTick);
    while (cursor < end) {
      const beat = measure.beats.find((item) => item.tick === cursor);
      const duration = beat && calculateRhythmTicks(beat.rhythm);
      if (beat && duration?.ok &&
        !measure.tuplets.some((group) => group.beatIds.includes(beat.id)) &&
        cursor + duration.ticks <= end) {
        result.push({ startTick: cursor, endTick: cursor + duration.ticks, rhythm: { ...beat.rhythm } });
        cursor += duration.ticks;
        continue;
      }
      const beatBoundary = Math.min(
        end,
        (Math.floor(cursor / unit) + 1) * unit,
      );
      // 无完整普通 TAB 节奏可借用时，沿拍号单位与 TAB 起点分解空白。
      const nextTabStart = tabStarts.find(
        (tick) =>
          tick > cursor &&
          tick < beatBoundary &&
          numberedRhythmForTicks(tick - cursor),
      );
      const boundary = nextTabStart ?? beatBoundary;
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
  appendBlank(cursor, getMeasureDurationTicks(measure));
  return result;
};

/**
 * 旧录入偏好仍可使用连续空白；如果会越过小节末尾或吃到下一个事件，
 * 改用当前虚拟格的准确时值。附点增减后产生的空格按当前简谱事件重新计算，
 * 即使 TAB 在同一位置没有起音，也能写入短空格而不切断、覆盖邻音或歌词空位。
 * 仅处理真实绘出的虚拟格；持久空格和高级编辑范围仍按其原有规则校验。
 */
export function numberedRhythmForBlockedInputPreference(
  measure: ILXMMeasure,
  startTick: number,
  endTick: number,
  preference: ILXMRhythm,
): ILXMRhythm | undefined {
  const duration = calculateRhythmTicks(preference);
  if (!duration.ok || startTick + duration.ticks <= endTick) return undefined;
  const preferredEnd = startTick + duration.ticks;
  if (preferredEnd <= getMeasureDurationTicks(measure) &&
    !measure.numberedVoice.events.some((event) => event.tick >= endTick && event.tick < preferredEnd))
    return undefined;
  return planNumberedInputRanges(measure).find((slot) =>
    !slot.eventId && slot.startTick === startTick && slot.endTick === endTick)?.rhythm;
}
