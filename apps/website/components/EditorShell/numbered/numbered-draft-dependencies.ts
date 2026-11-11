import { parseNumberedSequence, type ILXMTrack } from "@liuxianmao/lxm-editor";

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
