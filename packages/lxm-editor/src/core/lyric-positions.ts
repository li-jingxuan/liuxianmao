import { planNumberedInputRanges } from "./numbered-input-ranges";
import { createNumberedRhythmContext } from "./numbered-rhythm";
import type { ILXMMeasure } from "./types";

export interface LyricPosition {
  eventId?: string;
  tick: number;
  endTick: number;
}

/** 歌词位置包含音符、保留时值的空事件及尚未录入简谱的时间窗。 */
export const planLyricPositions = (measure: ILXMMeasure): LyricPosition[] => {
  measure = {
    ...measure,
    numberedVoice: {
      ...measure.numberedVoice,
      events: measure.numberedVoice.events
        .slice()
        .sort((a, b) => a.tick - b.tick),
    },
  };
  const context = createNumberedRhythmContext(measure.numberedVoice);
  return [
    ...measure.numberedVoice.events.flatMap((event) => {
      if (event.kind !== "notes" && event.kind !== "gap") return [];
      const duration = context.getEventDurationTicks(event);
      return duration.ok
        ? [
            {
              eventId: event.id,
              tick: event.tick,
              endTick: event.tick + duration.ticks,
            },
          ]
        : [];
    }),
    ...planNumberedInputRanges(measure)
      .filter((range) => !range.eventId)
      .map((range) => ({ tick: range.startTick, endTick: range.endTick })),
  ].sort((a, b) => a.tick - b.tick);
};

/** 原事件失效时不回退；时间窗落盘成空事件后仍可解析同一位置。 */
export const resolveLyricPosition = (
  measure: ILXMMeasure,
  target: { eventId?: string; tick?: number; endTick?: number },
): LyricPosition | undefined =>
  planLyricPositions(measure).find((position) =>
    target.eventId
      ? position.eventId === target.eventId
      : position.tick === target.tick && position.endTick === target.endTick,
  );
