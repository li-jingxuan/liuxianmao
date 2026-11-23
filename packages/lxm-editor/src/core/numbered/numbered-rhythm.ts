import { LXM_RHYTHM_BASES } from "../constants";
import { calculateRhythmTicks, getMeasureDurationTicks } from "../rhythm/rhythm";
import { isSupportedTupletRatio } from "../rhythm/tuplet";
import type { ILXMMeasure, ILXMNumberedEvent, ILXMNumberedVoice, ILXMRhythm, ILXMTimeSignature, ILXMTrack } from "../types";

export const NUMBERED_CONTINUATION_RHYTHM_REASON = "延音固定占当前拍号的一个分母单位，不能调整时值或添加附点。";
export const NUMBERED_CONTINUATION_SPACE_REASON = "当前位置不足一个拍号分母单位，无法录入延音。";
export const NUMBERED_CONTINUATION_METER_REASON = "当前拍号的一个分母单位无法写成无附点的简谱延音。";

/** 新录入按拍号分母取无附点时值；文档读取仍采用旧事件保存的时值。 */
export const numberedContinuationRhythm = ({ denominator }: ILXMTimeSignature): ILXMRhythm | undefined => {
  const base = LXM_RHYTHM_BASES[Math.log2(denominator)];
  return base ? { base, dots: 0 } : undefined;
};

/** 延音可替换选中的普通事件并占用未链接空白。源音的歌词清理与记号确认沿用既有命令规则，后续锚点一律保护。 */
export const numberedContinuationIssue = (
  track: ILXMTrack,
  measure: ILXMMeasure,
  start: number,
  end: number,
  context = createNumberedRhythmContext(measure.numberedVoice),
): string | null => {
  if (end > getMeasureDurationTicks(measure)) return NUMBERED_CONTINUATION_SPACE_REASON;
  for (const event of measure.numberedVoice.events) {
    if (event.tick >= end) break;
    const duration = context.getEventDurationTicks(event);
    if (!duration.ok || event.tick + duration.ticks <= start) continue;
    if (context.tupletByEventId.has(event.id)) return "延音不能占用简谱连音组成员。";
    if (event.tick === start && event.kind !== "gap") continue;
    if (measure.lyrics.some(lyric => lyric.eventId === event.id) || track.numberedMarks.some(mark => {
      if (mark.type === "fermata") return mark.eventId === event.id;
      if (mark.type === "slur") return mark.fromEventId === event.id || mark.toEventId === event.id;
      return event.items.some(item => item.id === mark.fromItemId || item.id === mark.toItemId);
    })) return "录入延音不能覆盖已有歌词或简谱记号的归属位置。";
    if (event.tick !== start && event.kind !== "gap") return "当前位置不足一个拍号分母单位，延音会覆盖后续简谱事件。";
  }
  return null;
};

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

/** 稀疏声部允许空白和独立 gap，但禁止重叠与越界。 */
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
      // 书写时值由基础音值和附点数决定，避免对象字段顺序影响同值判定。
      if (current.e.rhythm.base !== first.e.rhythm.base || current.e.rhythm.dots !== first.e.rhythm.dots)
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
    if (event.kind === "gap" && event.items.length)
      return "简谱 gap 内容不符合类型";
    const duration = context.getEventDurationTicks(event);
    if (!duration.ok) return "简谱实际时值无法表示为整数 tick";
    if (event.tick < end) return "简谱事件重叠或顺序无效";
    if (event.tick + duration.ticks > capacity) return "简谱事件超出小节容量";
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
    offset += getMeasureDurationTicks(m);
  }
  const items = new Map(
    [...events.values()].flatMap((entry) =>
      entry.event.items.map((item) => [item.id, { ...entry, item }] as const),
    ),
  );
  return { events, items };
};
