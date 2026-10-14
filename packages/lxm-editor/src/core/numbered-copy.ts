import type { ILXMIdFactory } from "./id-factory";
import type {
  ILXMMeasure,
  ILXMNumberedVoice,
  ILXMNumberedMark,
  ILXMTrack,
} from "./types";
/** 全范围统一映射简谱身份，内部跨小节关系只复制一次。 */
export const copyNumberedVoices = (
  track: ILXMTrack,
  sources: ILXMMeasure[],
  factory: ILXMIdFactory,
) => {
  const ids = new Map<string, string>();
  const voices: ILXMNumberedVoice[] = sources.map((m) => {
    const events = m.numberedVoice.events.map((e) => {
      const id = factory.createNumberedEventId();
      ids.set(e.id, id);
      const items = e.items.map((i) => {
        const itemId = factory.createNumberedItemId();
        ids.set(i.id, itemId);
        return { ...i, id: itemId };
      });
      return e.kind === "gap"
        ? { ...e, id, rhythm: { ...e.rhythm }, items: [] as [] }
        : { ...e, id, rhythm: { ...e.rhythm }, items };
    });
    return {
      events,
      tuplets: m.numberedVoice.tuplets.map((g) => ({
        ...g,
        id: factory.createNumberedTupletId(),
        ratio: { ...g.ratio },
        eventIds: g.eventIds.map((id) => ids.get(id)!),
      })),
    };
  });
  const marks = track.numberedMarks.flatMap((m): ILXMNumberedMark[] => {
    if (m.type === "tie")
      return ids.has(m.fromItemId) && ids.has(m.toItemId)
        ? [
            {
              ...m,
              id: factory.createNumberedMarkId(),
              fromItemId: ids.get(m.fromItemId)!,
              toItemId: ids.get(m.toItemId)!,
            },
          ]
        : [];
    if (m.type === "slur")
      return ids.has(m.fromEventId) && ids.has(m.toEventId)
        ? [
            {
              ...m,
              id: factory.createNumberedMarkId(),
              fromEventId: ids.get(m.fromEventId)!,
              toEventId: ids.get(m.toEventId)!,
            },
          ]
        : [];
    return ids.has(m.eventId)
      ? [
          {
            ...m,
            id: factory.createNumberedMarkId(),
            eventId: ids.get(m.eventId)!,
          },
        ]
      : [];
  });
  return { voices, marks };
};
