import {
  createNumberedRhythmContext,
  type ILXMNumberedEvent,
  type ILXMNumberedVoiceCommand,
  type ILXMTrack,
  type NumberedCandidate,
} from "@liuxianmao/lxm-editor";

export type NumberedPreviewStatus = "add" | "change" | "same" | "remove";

export interface NumberedPreviewRow {
  key: string;
  measureId: string;
  measureNumber: number;
  startTick: number;
  endTick: number;
  before: string;
  after: string;
  status: NumberedPreviewStatus;
  impact: "none" | "overwrite" | "release";
}

const eventText = (event: ILXMNumberedEvent | undefined): string =>
  event ? event.items.map((item) => item.token).join("+") || "空白" : "—";

const eventEnd = (
  track: ILXMTrack,
  measureId: string,
  event: ILXMNumberedEvent,
): number => {
  const measure = track.measures.find((item) => item.id === measureId);
  if (!measure) return event.tick;
  const duration = createNumberedRhythmContext(
    measure.numberedVoice,
  ).getEventDurationTicks(event);
  return duration.ok ? event.tick + duration.ticks : event.tick;
};

const isAffectedByRange = (
  track: ILXMTrack,
  measureId: string,
  event: ILXMNumberedEvent,
  startTick: number,
  endTick: number,
): boolean => {
  const end = eventEnd(track, measureId, event);
  return event.tick < endTick && end > startTick;
};

/**
 * 将 core 候选映射成 UI 行，不重新计算音乐规划；预览只负责解释前后值和影响。
 * range.replace 按 tick 对齐，避免新建事件 ID 让整批修改看起来全部是删除/新增。
 */
export const buildNumberedPreviewRows = (
  beforeTrack: ILXMTrack,
  candidate: Extract<NumberedCandidate, { ok: true }>,
  command: ILXMNumberedVoiceCommand,
): NumberedPreviewRow[] => {
  const measureId = "measureId" in command ? command.measureId : undefined;
  if (!measureId) return [];
  const measureIndex = beforeTrack.measures.findIndex(
    (item) => item.id === measureId,
  );
  const beforeMeasure = beforeTrack.measures[measureIndex];
  const afterMeasure = candidate.track.measures.find(
    (item) => item.id === measureId,
  );
  if (!beforeMeasure || !afterMeasure) return [];

  const isRange = command.type === "numbered.range.replace";
  const beforeEvents = beforeMeasure.numberedVoice.events.filter((event) =>
    isRange
      ? isAffectedByRange(
          beforeTrack,
          measureId,
          event,
          command.startTick,
          command.endTick,
        )
      : "eventId" in command
        ? event.id === command.eventId
        : false,
  );
  const afterEvents = afterMeasure.numberedVoice.events.filter((event) =>
    isRange
      ? isAffectedByRange(
          candidate.track,
          measureId,
          event,
          command.startTick,
          command.endTick,
        )
      : "eventId" in command
        ? event.id === command.eventId
        : false,
  );
  const beforeByKey = new Map(
    beforeEvents.map((event) => [isRange ? `tick:${event.tick}` : event.id, event]),
  );
  const afterByKey = new Map(
    afterEvents.map((event) => [isRange ? `tick:${event.tick}` : event.id, event]),
  );
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  return [...keys]
    .map((key) => {
      const before = beforeByKey.get(key);
      const after = afterByKey.get(key);
      const beforeValue = eventText(before);
      const afterValue = eventText(after);
      const status: NumberedPreviewStatus =
        !before ? "add" : !after ? "remove" : beforeValue === afterValue &&
          JSON.stringify(before.rhythm) === JSON.stringify(after.rhythm)
          ? "same"
          : "change";
      const startTick = after?.tick ?? before?.tick ?? 0;
      const endTick = after
        ? eventEnd(candidate.track, measureId, after)
        : before
          ? eventEnd(beforeTrack, measureId, before)
          : startTick;
      const impact = before && candidate.overwrittenEventIds.includes(before.id)
        ? "overwrite"
        : candidate.releasedRange &&
            startTick >= candidate.releasedRange.startTick &&
            startTick < candidate.releasedRange.endTick
          ? "release"
          : "none";
      return {
        key,
        measureId,
        measureNumber: measureIndex + 1,
        startTick,
        endTick,
        before: beforeValue,
        after: afterValue,
        status,
        impact,
      } satisfies NumberedPreviewRow;
    })
    .sort((a, b) => a.startTick - b.startTick || a.key.localeCompare(b.key));
};
