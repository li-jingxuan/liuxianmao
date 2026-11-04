import {
  createNumberedRhythmContext,
  type ILXMNumberedEvent,
  type ILXMNumberedVoiceCommand,
  type ILXMTrack,
  type NumberedCandidate,
} from "@liuxianmao/lxm-editor";
import { formatNumberedBeatPosition } from "./numbered-editor-target";
import type { BeatMappingRow, BeatMappingPosition } from "./BeatMappingPreview";

export type NumberedPreviewStatus =
  | "add"
  | "change"
  | "same"
  | "remove"
  | "skip"
  | "release";
export interface NumberedPreviewRow {
  key: string;
  measureId: string;
  measureNumber: number;
  position: string;
  startTick: number;
  endTick: number;
  before: string;
  after: string;
  rhythm: string;
  status: NumberedPreviewStatus;
  impact: "none" | "overwrite" | "release";
  eventId?: string;
  sourcePosition: BeatMappingPosition | null;
  plannedPosition: BeatMappingPosition | null;
}
const bases = {
  whole: "全音",
  half: "二分",
  quarter: "四分",
  eighth: "八分",
  sixteenth: "十六分",
  thirtySecond: "三十二分",
};
const eventText = (event?: ILXMNumberedEvent) =>
  event ? event.items.map((item) => item.token).join("+") || "空白" : "—";
const eventEnd = (
  track: ILXMTrack,
  measureId: string,
  event: ILXMNumberedEvent,
) => {
  const measure = track.measures.find((item) => item.id === measureId);
  if (!measure) return event.tick;
  const duration = createNumberedRhythmContext(
    measure.numberedVoice,
  ).getEventDurationTicks(event);
  return duration.ok ? event.tick + duration.ticks : event.tick;
};

/** 仅解释 core 的候选：连续内容逐事件遍历真实跨小节结果，跳拍与同值分别保留。 */
export const buildNumberedPreviewRows = (
  beforeTrack: ILXMTrack,
  candidate: Extract<NumberedCandidate, { ok: true }>,
  command: ILXMNumberedVoiceCommand,
): NumberedPreviewRow[] => {
  const rows: NumberedPreviewRow[] = [];
  const append = (
    measureId: string,
    before: ILXMNumberedEvent | undefined,
    after: ILXMNumberedEvent | undefined,
    skipped = false,
  ) => {
    const measureIndex = beforeTrack.measures.findIndex(
      (item) => item.id === measureId,
    );
    const measure = candidate.track.measures.find(
      (item) => item.id === measureId,
    );
    if (!measure) return;
    const event = after ?? before;
    if (!event) return;
    const status: NumberedPreviewStatus = skipped
      ? "skip"
      : !before
        ? "add"
        : !after
          ? "remove"
          : eventText(before) === eventText(after) &&
              JSON.stringify(before.rhythm) === JSON.stringify(after.rhythm)
            ? "same"
            : "change";
    const tuplet = measure.numberedVoice.tuplets.find((group) =>
      group.eventIds.includes(event.id),
    );
    rows.push({
      key: `${measureId}/${event.tick}/${event.id}`,
      eventId: event.id,
      sourcePosition: before ? { trackId: beforeTrack.id, measureId, startTick: before.tick, endTick: eventEnd(beforeTrack, measureId, before) } : null,
      plannedPosition: after ? { trackId: candidate.track.id, measureId, startTick: after.tick, endTick: eventEnd(candidate.track, measureId, after) } : null,
      measureId,
      measureNumber: measureIndex + 1,
      position: formatNumberedBeatPosition(
        event.tick,
        measure.timeSignature.denominator,
      ),
      startTick: event.tick,
      endTick: eventEnd(
        after ? candidate.track : beforeTrack,
        measureId,
        event,
      ),
      before: eventText(before),
      after: eventText(after),
      rhythm: `${bases[event.rhythm.base]}${event.rhythm.dots ? ` · ${event.rhythm.dots} 附点` : ""}${tuplet ? ` · ${tuplet.ratio.actual}:${tuplet.ratio.normal}` : ""}`,
      status,
      impact:
        before && candidate.overwrittenEventIds.includes(before.id)
          ? "overwrite"
          : "none",
    });
  };
  if (command.type === "numbered.sequence.set") {
    const events = beforeTrack.measures.flatMap((measure) =>
      measure.numberedVoice.events.map((event) => ({ measure, event })),
    );
    const start = events.findIndex(
      ({ measure, event }) =>
        measure.id === command.measureId && event.id === command.eventId,
    );
    if (start < 0) return [];
    command.items.forEach((item, index) => {
      const original = events[start + index];
      if (!original) return;
      const next = candidate.track.measures
        .find((m) => m.id === original.measure.id)
        ?.numberedVoice.events.find((e) => e.id === original.event.id);
      append(original.measure.id, original.event, next, item.kind === "skip");
    });
    return rows;
  }
  if (!("measureId" in command)) return rows;
  const measure = beforeTrack.measures.find((m) => m.id === command.measureId);
  const after = candidate.track.measures.find(
    (m) => m.id === command.measureId,
  );
  if (!measure || !after) return rows;
  const isRange =
    command.type === "numbered.range.replace" ||
    command.type === "numbered.range.paste";
  const key = (event: ILXMNumberedEvent) =>
    isRange ? `tick:${event.tick}` : event.id;
  const beforeByKey = new Map(
    measure.numberedVoice.events.map((event) => [key(event), event]),
  );
  const afterByKey = new Map(
    after.numberedVoice.events.map((event) => [key(event), event]),
  );
  for (const id of new Set([...beforeByKey.keys(), ...afterByKey.keys()])) {
    const original = beforeByKey.get(id),
      next = afterByKey.get(id);
    const changed = JSON.stringify(original) !== JSON.stringify(next);
    const inRange =
      command.type === "numbered.range.replace" &&
      (next ?? original)!.tick < command.endTick &&
      eventEnd(
        next ? candidate.track : beforeTrack,
        measure.id,
        (next ?? original)!,
      ) > command.startTick;
    const targeted =
      "eventId" in command &&
      (original?.id === command.eventId || next?.id === command.eventId);
    if (changed || inRange || targeted) append(measure.id, original, next);
  }
  if (candidate.releasedRange) {
    const { startTick, endTick } = candidate.releasedRange;
    rows.push({
      key: `${measure.id}/released`,
      measureId: measure.id,
      measureNumber: beforeTrack.measures.indexOf(measure) + 1,
      position: formatNumberedBeatPosition(
        startTick,
        measure.timeSignature.denominator,
      ),
      startTick,
      endTick,
      before: "原持续范围",
      after: "可继续录入的空位",
      rhythm: "不补休止",
      status: "release",
      impact: "release",
      sourcePosition: { trackId: beforeTrack.id, measureId: measure.id, startTick, endTick },
      plannedPosition: null,
    });
  }
  return rows.sort((a, b) => a.startTick - b.startTick);
};

/** 不拆 key 推测领域身份；原位置与候选位置随真实事件一起生成。 */
export const numberedPreviewMapping = (rows: readonly NumberedPreviewRow[]): BeatMappingRow[] => rows.map((row) => ({
  key: row.key,
  before: row.before,
  after: row.after,
  positionLabel: `${row.measureNumber} 小节 · ${row.position}`,
  status: row.status,
  sourcePosition: row.sourcePosition,
  plannedPosition: row.plannedPosition,
  canInspect: !!row.sourcePosition,
  rhythm: row.rhythm,
  impactLabel: row.impact === "overwrite" ? "覆盖" : row.impact === "release" ? "释放空位" : undefined,
}));
