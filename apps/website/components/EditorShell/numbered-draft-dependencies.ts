import {
  parseNumberedSequence,
  type ILXMDocument,
  type ILXMTrack,
} from "@liuxianmao/lxm-editor";
import type { NumberedEditorDraft } from "./NumberedEditor";
import type { MusicTextTarget } from "./music-text-draft";

/** 保守地绑定草稿读取的小节；连续均匀录入还包含实际跨越的小节及记号。 */
export const numberedDraftDependency = (
  track: ILXMTrack | undefined,
  target: MusicTextTarget,
  draft: NumberedEditorDraft,
): string => {
  if (!track) return "missing";
  const measure = track.measures.find((item) => item.id === target.measureId);
  if (!measure) return "missing";
  const ids = new Set([measure.id]);
  if (
    draft.mode === "sequence" &&
    draft.template === "uniform" &&
    draft.selectedId
  ) {
    const events = track.measures.flatMap((m) =>
      m.numberedVoice.events.map((event) => ({ m, event })),
    );
    const index = events.findIndex(
      ({ event }) => event.id === draft.selectedId,
    );
    const parsed = parseNumberedSequence(draft.raw);
    if (index >= 0 && parsed.ok)
      events
        .slice(index, index + parsed.items.length)
        .forEach(({ m }) => ids.add(m.id));
  }
  const measures = track.measures.filter((m) => ids.has(m.id));
  const eventIds = new Set(
    measures.flatMap((m) => m.numberedVoice.events.map((e) => e.id)),
  );
  const itemIds = new Set(
    measures.flatMap((m) =>
      m.numberedVoice.events.flatMap((e) => e.items.map((i) => i.id)),
    ),
  );
  return JSON.stringify({
    measures: measures.map((m) => ({
      id: m.id,
      timeSignature: m.timeSignature,
      voice: m.numberedVoice,
    })),
    marks: track.numberedMarks.filter((mark) =>
      mark.type === "tie"
        ? itemIds.has(mark.fromItemId) || itemIds.has(mark.toItemId)
        : mark.type === "slur"
          ? eventIds.has(mark.fromEventId) || eventIds.has(mark.toEventId)
          : eventIds.has(mark.eventId),
    ),
  });
};

export const numberedTargetTrack = (
  document: ILXMDocument | null,
  target: MusicTextTarget,
) => document?.score.tracks.find((track) => track.id === target.trackId);

/** 当前内容组只依赖事件身份/位置/内容；时值组可独立提交而不改变 raw 基线。 */
export const numberedContentDependency = (
  track: ILXMTrack,
  measureId: string,
  eventId: string | undefined,
  raw: string,
): string => {
  const events = track.measures.flatMap((measure) =>
    measure.numberedVoice.events.map((event) => ({
      measureId: measure.id,
      event,
    })),
  );
  const start = events.findIndex(
    (row) => row.measureId === measureId && row.event.id === eventId,
  );
  const parsed = parseNumberedSequence(raw);
  const relevant =
    start >= 0
      ? events.slice(
          start,
          start + (parsed.ok ? Math.max(1, parsed.items.length) : 1),
        )
      : events.filter((row) => row.measureId === measureId);
  return JSON.stringify(
    relevant.map(({ measureId, event }) => ({
      measureId,
      id: event.id,
      tick: event.tick,
      items: event.items,
    })),
  );
};
