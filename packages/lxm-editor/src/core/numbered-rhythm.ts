import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import { isSupportedTupletRatio } from "./tuplet";
import type { ILXMNumberedEvent, ILXMNumberedVoice, ILXMTrack } from "./types";

/** 每小节只建一次比例索引；简谱不查询 TAB 的连音成员。 */
export const createNumberedRhythmContext = (voice: ILXMNumberedVoice) => {
  const tupletByEventId = new Map(
    voice.tuplets.flatMap((g) => g.eventIds.map((id) => [id, g] as const)),
  );
  const getEventDurationTicks = (event: ILXMNumberedEvent) => {
    const written = calculateRhythmTicks(event.rhythm);
    if (!written.ok) return written;
    const group = tupletByEventId.get(event.id);
    if (!group) return written;
    const n = written.ticks * group.ratio.normal;
    return n % group.ratio.actual === 0
      ? { ok: true as const, ticks: n / group.ratio.actual }
      : { ok: false as const, code: "NON_INTEGER_TUPLET_TICKS" as const };
  };
  return { tupletByEventId, getEventDurationTicks };
};

/** 稀疏声部允许空白，但禁止重叠、越界和孤立 gap。 */
export const validateNumberedVoice = (
  voice: ILXMNumberedVoice,
  capacity: number,
): string | null => {
  const context = createNumberedRhythmContext(voice);
  const members = new Set<string>();
  const byId = new Map(voice.events.map((e, i) => [e.id, { e, i }]));
  let previousGroup = -1;
  for (const group of voice.tuplets) {
    if (
      !isSupportedTupletRatio(group.ratio) ||
      group.eventIds.length !== group.ratio.actual
    )
      return "简谱连音比例或成员数量无效";
    const first = byId.get(group.eventIds[0]!);
    if (!first || first.i < previousGroup) return "简谱连音组顺序无效";
    previousGroup = first.i;
    for (const [i, id] of group.eventIds.entries()) {
      const current = byId.get(id);
      if (!current || current.i !== first.i + i || members.has(id))
        return "简谱连音成员须完整连续且不重复归组";
      if (JSON.stringify(current.e.rhythm) !== JSON.stringify(first.e.rhythm))
        return "简谱连音书写时值须一致";
      if (i > 0) {
        const last = voice.events[current.i - 1]!;
        const d = context.getEventDurationTicks(last);
        if (!d.ok || last.tick + d.ticks !== current.e.tick)
          return "简谱连音时间须连续";
      }
      members.add(id);
    }
  }
  let end = 0;
  for (const event of voice.events) {
    const duration = context.getEventDurationTicks(event);
    if (!duration.ok) return "简谱实际时值无法表示为整数 tick";
    if (event.tick < end) return "简谱事件重叠或顺序无效";
    if (event.tick + duration.ticks > capacity) return "简谱事件超出小节容量";
    if (event.kind === "gap" && !members.has(event.id))
      return "简谱 gap 必须归属一个连音组";
    end = event.tick + duration.ticks;
  }
  return null;
};

/** 跨小节索引使用绝对时间；起音位置不依赖 TAB Beat 身份。 */
export const buildNumberedIndex = (track: ILXMTrack) => {
  let offset = 0;
  const events = new Map<
    string,
    {
      event: ILXMNumberedEvent;
      measureId: string;
      measureIndex: number;
      order: number;
      start: number;
      end: number;
    }
  >();
  let order = 0;
  for (const [measureIndex, m] of track.measures.entries()) {
    const context = createNumberedRhythmContext(m.numberedVoice);
    for (const event of m.numberedVoice.events) {
      const duration = context.getEventDurationTicks(event);
      events.set(event.id, {
        event,
        measureId: m.id,
        measureIndex,
        order: order++,
        start: offset + event.tick,
        end: offset + event.tick + (duration.ok ? duration.ticks : 0),
      });
    }
    offset += getMeasureCapacityTicks(m.timeSignature);
  }
  const items = new Map(
    [...events.values()].flatMap((entry) =>
      entry.event.items.map((item) => [item.id, { ...entry, item }] as const),
    ),
  );
  return { events, items };
};
