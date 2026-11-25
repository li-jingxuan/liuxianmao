import type { ILXMIdFactory } from "../id-factory";
import { calculateRhythmTicks, getMeasureDurationTicks } from "../rhythm/rhythm";
import type { ILXMMeasure, ILXMNumberedTuplet, ILXMTrack } from "../types";
import type { ILXMNumberedTupletCommand, NumberedCandidate } from "./numbered-commands";
import { validateNumberedMarks } from "./numbered-marks";
import { buildNumberedIndex, createNumberedTrackRhythmContext, findInvalidNumberedTrack } from "./numbered-rhythm";

const ratio = { actual: 3, normal: 2 } as const;
type EventEntry = ReturnType<typeof buildNumberedIndex>["events"] extends Map<string, infer Entry> ? Entry : never;
type Failure = Extract<NumberedCandidate, { ok: false }>;
const fail = (message: string, code: Failure["code"] = "NUMBERED_INVALID"): Failure => ({ ok: false, code, message });

type Edit = { add: ILXMNumberedTuplet } | { remove: ILXMNumberedTuplet };

/** 只重排这三个事件和其附属歌词。根据新起音选择所在小节，跨线持续仍是同一事件。 */
const redistribute = (
  track: ILXMTrack,
  owner: ILXMMeasure,
  next: ILXMMeasure,
  entries: EventEntry[],
  step: number,
  edit: Edit,
  factory?: Pick<ILXMIdFactory, "createNumberedTupletId">,
): NumberedCandidate => {
  const ids = new Set(entries.map(({ event }) => event.id));
  const lyrics = [...owner.lyrics, ...next.lyrics].filter(lyric => ids.has(lyric.eventId));
  const capacity = getMeasureDurationTicks(owner);
  const nextCapacity = getMeasureDurationTicks(next);
  const adding = "add" in edit;
  const movedEventIds: string[] = [];
  const relocated = entries.map(({ event, measureId }, index) => {
    const relativeTick = entries[0]!.event.tick + index * step;
    const startsInOwner = relativeTick < capacity;
    const destination = startsInOwner ? owner.id : next.id;
    const tick = startsInOwner ? relativeTick : relativeTick - capacity;
    if (tick !== event.tick || destination !== measureId) movedEventIds.push(event.id);
    return { destination, event: tick === event.tick ? event : { ...event, tick } };
  });
  // 展开后普通事件不能跨线，每个原起点和终点都必须仍落在已知的两个小节内。
  if (!adding && relocated.some(({ destination, event }) =>
    event.tick + step > (destination === owner.id ? capacity : nextCapacity)))
    return fail("小节空间不足，无法还原跨小节简谱三连音", "NUMBERED_OVERLAP");

  const measures = track.measures.map(measure => {
    if (measure !== owner && measure !== next) return measure;
    const members = relocated.filter(({ destination }) => destination === measure.id).map(({ event }) => event);
    const memberIds = new Set(members.map(event => event.id));
    const events = [...measure.numberedVoice.events.filter(event => !ids.has(event.id)), ...members]
      .sort((a, b) => a.tick - b.tick);
    const ticks = new Map(events.map(event => [event.id, event.tick]));
    const orderedLyrics = [...measure.lyrics.filter(lyric => !ids.has(lyric.eventId)), ...lyrics.filter(lyric => memberIds.has(lyric.eventId))]
      .sort((a, b) => ticks.get(a.eventId)! - ticks.get(b.eventId)! || a.verse - b.verse);
    let tuplets = measure.numberedVoice.tuplets;
    if (measure === owner) {
      tuplets = adding
        ? [...tuplets, edit.add].sort((a, b) => ticks.get(a.eventIds[0]!)! - ticks.get(b.eventIds[0]!)!)
        : tuplets.filter(group => group !== edit.remove);
    }
    return { ...measure, lyrics: orderedLyrics, numberedVoice: { events, tuplets } };
  });
  const candidate = { ...track, measures };
  // 校验整条时间线，包括实际跨线占用与移动后仍须成立的歌词外部记号。失败不申请新组 ID。
  const invalid = findInvalidNumberedTrack(candidate);
  if (invalid) return fail(`无法${adding ? "创建" : "移除"}跨小节简谱三连音（${invalid.message}）`, "NUMBERED_OVERLAP");
  const markError = candidate.numberedMarks.length ? validateNumberedMarks(candidate) : null;
  if (markError) return fail(`简谱连音修改与现有记号冲突：${markError}`);
  if (adding && factory) edit.add.id = factory.createNumberedTupletId();
  return {
    ok: true,
    changed: true,
    track: candidate,
    measureId: owner.id,
    movedEventIds,
    resizedEventIds: entries.map(({ event }) => event.id),
    overwrittenEventIds: [],
    removedMarkIds: [],
    changedMarkIds: [],
  };
};

export const addNumberedCrossBarTuplet = (
  track: ILXMTrack,
  owner: ILXMMeasure,
  command: Extract<ILXMNumberedTupletCommand, { type: "numbered.tuplet.add" }>,
  factory?: Pick<ILXMIdFactory, "createNumberedTupletId">,
): NumberedCandidate => {
  const context = createNumberedTrackRhythmContext(track);
  const { events } = buildNumberedIndex(track, context);
  const entries = [...new Set(command.eventIds)].flatMap(id => {
    const entry = events.get(id);
    return entry ? [entry] : [];
  }).sort((a, b) => a.order - b.order);
  const [first, , last] = entries;
  const next = first && track.measures[first.measureIndex + 1];
  if (command.eventIds.length !== 3 || entries.length !== 3 || !first || !last || !next ||
      first.measureId !== owner.id || last.measureId !== next.id || entries.some(({ event }) => event.kind !== "notes"))
    return fail("请选择同一小节或相邻小节首尾的三个普通简谱音事件");
  if (entries.some(({ event }) => context.tupletByEventId.has(event.id)))
    return fail("已有简谱连音组的成员不能再次归组");
  if (entries.some(({ event }) => event.rhythm.base !== first.event.rhythm.base || event.rhythm.dots !== first.event.rhythm.dots))
    return fail("三连音成员的书写时值须一致");
  const written = calculateRhythmTicks(first.event.rhythm);
  if (!written.ok || (written.ticks * ratio.normal) % ratio.actual !== 0)
    return fail("简谱三连音实际时值无法表示为整数 tick");
  if (entries.some((entry, index) => entry.order !== first.order + index || entry.start !== first.start + index * written.ticks))
    return fail("请选择三个时间连续且中间无空位的简谱音事件");
  const group = { id: "", ratio: { ...ratio }, eventIds: entries.map(({ event }) => event.id), crossBar: { nextMeasureId: next.id } };
  return redistribute(track, owner, next, entries, written.ticks * ratio.normal / ratio.actual, { add: group }, factory);
};

export const removeNumberedCrossBarTuplet = (
  track: ILXMTrack,
  owner: ILXMMeasure,
  group: ILXMNumberedTuplet,
): NumberedCandidate => {
  const next = track.measures[track.measures.indexOf(owner) + 1];
  const { events } = buildNumberedIndex(track);
  const entries = group.eventIds.flatMap(id => {
    const entry = events.get(id);
    return entry ? [entry] : [];
  });
  if (!next || next.id !== group.crossBar?.nextMeasureId || entries.length !== 3 || entries[0]?.measureId !== owner.id)
    return fail("跨小节简谱三连音成员或相邻小节不存在");
  const written = calculateRhythmTicks(entries[0]!.event.rhythm);
  if (!written.ok) return fail("书写时值无效");
  return redistribute(track, owner, next, entries, written.ticks, { remove: group });
};
