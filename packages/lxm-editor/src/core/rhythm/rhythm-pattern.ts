import { TICKS_PER_QUARTER } from "../constants";
import { createDocumentIdFactory } from "../id-factory";
import { semanticJsonEqual } from "../document/score-tonality";
import { buildNumberedIndex, createNumberedRhythmContext } from "../numbered/numbered-rhythm";
import { calculateRhythmTicks, createRestRhythmsForTicks, getMeasureCapacityTicks } from "./rhythm";
import { createMeasureRhythmContext } from "./tuplet";
import { isPureTabContinuationBeat, tabContinuationRhythm } from "./tab-continuation";
import type { ILXMBeat, ILXMDocument, ILXMNumberedEvent, ILXMRhythm, ILXMTimeSignature, ILXMTrack } from "../types";

export interface RhythmPatternTarget {
  layer: "numbered" | "tab";
  trackId: string;
  measureId: string;
  /** 原始选区；单点用 startTick === endTick，不能把长音的时值当作多拍选区。 */
  startTick: number;
  endTick: number;
  focusTick: number;
}
export interface RhythmPatternTemplate {
  readonly id: string;
  readonly name: string;
  /** 原型中的十六分单位，仅供展示；规划使用精确 ticks。 */
  readonly values: readonly number[];
  readonly detail: boolean;
  readonly beatTicks: number;
  readonly rhythms: readonly ILXMRhythm[];
  readonly ticks: readonly number[];
}
const rhythmForValue = (value: number): ILXMRhythm => {
  switch (value) {
    case 0.5: return { base: "thirtySecond", dots: 0 };
    case 1: return { base: "sixteenth", dots: 0 };
    case 2: return { base: "eighth", dots: 0 };
    case 3: return { base: "eighth", dots: 1 };
    case 4: return { base: "quarter", dots: 0 };
    case 6: return { base: "quarter", dots: 1 };
    default: throw new Error("未知节奏型时值");
  }
};
const template = (id: string, name: string, values: number[], detail = false): RhythmPatternTemplate =>
  Object.freeze({ id, name, values: Object.freeze(values), detail,
    beatTicks: values.reduce((a, b) => a + b, 0) * TICKS_PER_QUARTER / 4,
    rhythms: Object.freeze(values.map(value => Object.freeze(rhythmForValue(value)))),
    ticks: Object.freeze(values.map(value => value * TICKS_PER_QUARTER / 4)),
  });
export const RHYTHM_PATTERN_TEMPLATES: readonly RhythmPatternTemplate[] = Object.freeze([
  template("quarter", "四分音符", [4]),
  template("eighths", "两个八分", [2, 2]),
  template("eight-sixteen", "前八后十六", [2, 1, 1]),
  template("sixteen-eight", "前十六后八", [1, 1, 2]),
  template("sixteenths", "四个十六分", [1, 1, 1, 1]),
  template("dotted-eight", "附点八分＋十六", [3, 1]),
  template("small-syncopation", "小切分", [1, 2, 1]),
  template("reverse-dotted", "十六＋附点八分", [1, 3]),
  template("dotted-two-thirtyseconds", "附点八分＋两三十二", [3, 0.5, 0.5], true),
  template("two-thirtyseconds-dotted", "两三十二＋附点八分", [0.5, 0.5, 3], true),
  template("eighth-four-thirtyseconds", "八分＋四三十二", [2, 0.5, 0.5, 0.5, 0.5], true),
  template("four-thirtyseconds-eighth", "四三十二＋八分", [0.5, 0.5, 0.5, 0.5, 2], true),
  template("dotted-quarter", "附点四分", [6]),
  template("three-eighths", "三个八分", [2, 2, 2]),
  template("quarter-eight", "四分＋八分", [4, 2]),
  template("eight-quarter", "八分＋四分", [2, 4]),
  template("six-sixteenths", "六个十六分", [1, 1, 1, 1, 1, 1]),
]);
export const getRhythmPatternTemplates = (signature: ILXMTimeSignature): readonly RhythmPatternTemplate[] => {
  const ticks = signature.denominator === 4 && [3, 4].includes(signature.numerator)
    ? TICKS_PER_QUARTER
    : signature.denominator === 8 && signature.numerator === 6 ? TICKS_PER_QUARTER * 1.5 : 0;
  return RHYTHM_PATTERN_TEMPLATES.filter(item => item.beatTicks === ticks);
};

export type RhythmPatternEvent = ILXMBeat | ILXMNumberedEvent;
export interface RhythmPatternScope {
  startTick: number;
  endTick: number;
  beatTicks: number;
  beatCount: number;
  firstBeat: number;
  lastBeat: number;
}
export interface RhythmPatternRemovedMark {
  id: string;
  type: string;
  name: string;
  crossesScope: boolean;
}
export interface RhythmPatternBeatSummary {
  beatNumber: number;
  startTick: number;
  endTick: number;
  retainedCount: number;
  discardedCount: number;
  gapCount: number;
  before: RhythmPatternEvent[];
  after: RhythmPatternEvent[];
}
export type RhythmPatternErrorCode = "INVALID_RHYTHM_PATTERN_TARGET" | "UNSUPPORTED_TIME_SIGNATURE" | "RHYTHM_PATTERN_TEMPLATE_MISMATCH" | "RHYTHM_PATTERN_CROSSING_CONTENT" | "RHYTHM_PATTERN_PARTIAL_TUPLET" | "RHYTHM_PATTERN_FIXED_CONTINUATION" | "RHYTHM_NOT_REPRESENTABLE";
export type RhythmPatternPlan = {
  ok: true;
  target: RhythmPatternTarget;
  scope: RhythmPatternScope;
  template: RhythmPatternTemplate;
  before: RhythmPatternEvent[];
  after: RhythmPatternEvent[];
  /** 原连音的实际时值，预览不能只用书写 rhythm 推算。 */
  beforeDurationTicks: Record<string, number>;
  perBeat: RhythmPatternBeatSummary[];
  removedMarks: RhythmPatternRemovedMark[];
  discardedTextCount: number;
  confirmationKey: string;
  track: ILXMTrack;
  changed: boolean;
  focus: { trackId: string; measureId: string; tick: number; endTick: number; eventId?: string; beatId?: string };
} | { ok: false; code: RhythmPatternErrorCode; message: string };

const markNames: Record<string, string> = {
  tie: "延音线", slur: "圆滑线", fermata: "延长记号", tuplet: "连音组",
  bend: "推弦", vibrato: "揉弦", naturalHarmonic: "自然泛音", artificialHarmonic: "人工泛音",
  tapping: "点弦", trill: "颤音", hammerOn: "击弦", pullOff: "勾弦", slideUp: "上滑音", slideDown: "下滑音",
  strum: "扫弦", arpeggio: "琶音", pickStroke: "拨片方向", palmMute: "掌根闷音", letRing: "持续发声",
};
interface Interval { start: number; end: number }
const overlaps = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;

/** 按焦点所在的完整演奏拍识别节奏；空位和休止同样参与，缺口或跨拍事件不猜测。 */
export const inferRhythmPatternTemplate = (document: ILXMDocument, target: RhythmPatternTarget): RhythmPatternTemplate | null => {
  const track = document.score.tracks.find(item => item.id === target.trackId);
  const measure = track?.measures.find(item => item.id === target.measureId);
  if (!measure || !["numbered", "tab"].includes(target.layer)) return null;
  const templates = getRhythmPatternTemplates(measure.timeSignature);
  const beatTicks = templates[0]?.beatTicks;
  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  if (!beatTicks || ![target.startTick, target.endTick, target.focusTick].every(Number.isInteger) ||
      target.startTick < 0 || target.endTick < target.startTick || target.endTick > capacity ||
      target.startTick >= capacity || target.focusTick < 0 || target.focusTick >= capacity) return null;
  const start = Math.floor(target.focusTick / beatTicks) * beatTicks;
  const end = start + beatTicks;
  const numberedContext = createNumberedRhythmContext(measure.numberedVoice);
  const tabContext = createMeasureRhythmContext(measure);
  const source: RhythmPatternEvent[] = target.layer === "numbered" ? measure.numberedVoice.events : measure.beats;
  const events: { tick: number; ticks: number }[] = [];
  for (const event of source) {
    const duration = "items" in event ? numberedContext.getEventDurationTicks(event) : tabContext.getBeatDurationTicks(event);
    if (!duration.ok) return null;
    if (overlaps({ start: event.tick, end: event.tick + duration.ticks }, { start, end }))
      events.push({ tick: event.tick, ticks: duration.ticks });
  }
  events.sort((a, b) => a.tick - b.tick);
  return templates.find(item => {
    if (events.length !== item.ticks.length) return false;
    let tick = start;
    return item.ticks.every((ticks, index) => {
      const event = events[index]!;
      const matches = event.tick === tick && event.ticks === ticks;
      tick += ticks;
      return matches;
    });
  }) ?? null;
};

/** 纯规划：只构造候选轨道，不提交 revision、历史或任何页面状态。 */
export const planRhythmPattern = (document: ILXMDocument, target: RhythmPatternTarget, templateId: string): RhythmPatternPlan => {
  const fail = (code: RhythmPatternErrorCode, message: string): RhythmPatternPlan => ({ ok: false, code, message });
  const track = document.score.tracks.find(t => t.id === target.trackId);
  const measure = track?.measures.find(m => m.id === target.measureId);
  if (!track || !measure || !["numbered", "tab"].includes(target.layer))
    return fail("INVALID_RHYTHM_PATTERN_TARGET", "请先在当前简谱或 TAB 谱层选择同轨、同小节的位置。");
  const templates = getRhythmPatternTemplates(measure.timeSignature);
  if (!templates.length) return fail("UNSUPPORTED_TIME_SIGNATURE", "节奏型仅支持 4/4、3/4 和 6/8 拍。");
  const chosen = templates.find(t => t.id === templateId);
  if (!chosen) return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", "当前模板不适用于目标小节拍号，请重新选择。");
  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  if (![target.startTick, target.endTick, target.focusTick].every(Number.isInteger) ||
      target.startTick < 0 || target.endTick < target.startTick || target.endTick > capacity ||
      target.startTick >= capacity || target.focusTick < 0 || target.focusTick >= capacity)
    return fail("INVALID_RHYTHM_PATTERN_TARGET", "选区跨越小节或没有有效焦点，请选择同一小节内的范围。");
  const beatTicks = chosen.beatTicks;
  // 短选区按焦点落入的演奏拍处理；连续多拍才向外归齐。6/8 的演奏拍为附点四分，
  // 不按拍号分母拆成三个互相独立的八分拍，避免预览范围与实际提交不一致。
  const short = target.endTick - target.startTick < beatTicks;
  const startTick = Math.floor((short ? target.focusTick : target.startTick) / beatTicks) * beatTicks;
  const endTick = short ? startTick + beatTicks : Math.ceil(target.endTick / beatTicks) * beatTicks;
  const scope: RhythmPatternScope = { startTick, endTick, beatTicks, beatCount: (endTick - startTick) / beatTicks, firstBeat: startTick / beatTicks + 1, lastBeat: endTick / beatTicks };
  const interval = { start: startTick, end: endTick };
  const numbered = target.layer === "numbered";
  const numberedContext = createNumberedRhythmContext(measure.numberedVoice);
  const tabContext = createMeasureRhythmContext(measure);
  const source: RhythmPatternEvent[] = numbered ? measure.numberedVoice.events : measure.beats;
  const durations = new Map<string, number>();
  for (const event of source) {
    const result = "items" in event ? numberedContext.getEventDurationTicks(event) : tabContext.getBeatDurationTicks(event);
    if (!result.ok) return fail("RHYTHM_NOT_REPRESENTABLE", "原事件实际时值无法精确表示。");
    durations.set(event.id, result.ticks);
  }
  const eventInterval = (event: RhythmPatternEvent): Interval => ({ start: event.tick, end: event.tick + durations.get(event.id)! });
  const lyricIds = new Set(measure.lyrics.map(l => l.eventId));
  const chordIds = new Set(measure.chordSymbols.map(c => c.beatId));
  // 带歌词／和弦的空位也占一个内容位置，保留原 ID 才能保住所有歌词段及和弦引用。
  // 普通空位只提供可复用的 ID，不计入逐拍内容数；明确休止始终是内容。
  const hasContent = (event: RhythmPatternEvent) => "items" in event
    ? event.kind !== "gap" || lyricIds.has(event.id)
    : event.kind === "rest" || event.notes.length > 0 || chordIds.has(event.id);
  const relevant = source.filter(event => overlaps(eventInterval(event), interval));
  const removedMarks: RhythmPatternRemovedMark[] = [];
  const addMark = (id: string, type: string, crossesScope = false) => removedMarks.push({ id, type, name: markNames[type] ?? type, crossesScope });
  const groups = numbered
    ? measure.numberedVoice.tuplets.map(g => ({ id: g.id, ids: g.eventIds }))
    : measure.tuplets.map(g => ({ id: g.id, ids: g.beatIds }));
  const sourceById = new Map(source.map(event => [event.id, event]));
  for (const group of groups) {
    const members = group.ids.map(id => sourceById.get(id));
    if (!members.some(event => event && overlaps(eventInterval(event), interval))) continue;
    if (members.some(event => !event || event.tick < startTick || eventInterval(event).end > endTick))
      return fail("RHYTHM_PATTERN_PARTIAL_TUPLET", "目标只包含部分连音组，请扩大范围以包含完整连音组。");
    addMark(group.id, "tuplet");
  }
  if (relevant.some(event => hasContent(event) && (event.tick < startTick || eventInterval(event).end > endTick)))
    return fail("RHYTHM_PATTERN_CROSSING_CONTENT", "音符、休止或带歌词／和弦的空位跨出处理范围，请扩大选区以保留完整内容。");

  // 标记使用原时间轴判断；区间技巧即使两端均在范围外，也会影响中间目标。
  let measureOffset = 0;
  for (const m of track.measures) {
    if (m === measure) break;
    measureOffset += getMeasureCapacityTicks(m.timeSignature);
  }
  const absoluteScope = { start: measureOffset + startTick, end: measureOffset + endTick };
  const affected = (id: string, type: string, endpoints: (Interval | undefined)[]) => {
    const points = endpoints.filter((point): point is Interval => !!point);
    if (!points.length) return;
    const span = { start: Math.min(...points.map(p => p.start)), end: Math.max(...points.map(p => p.end)) };
    if (overlaps(span, absoluteScope)) addMark(id, type, points.some(p => p.start < absoluteScope.start || p.end > absoluteScope.end));
  };
  if (numbered) {
    const index = buildNumberedIndex(track);
    for (const mark of track.numberedMarks) {
      const points = mark.type === "tie" ? [index.items.get(mark.fromItemId), index.items.get(mark.toItemId)]
        : mark.type === "slur" ? [index.events.get(mark.fromEventId), index.events.get(mark.toEventId)] : [index.events.get(mark.eventId)];
      affected(mark.id, mark.type, points);
    }
  } else {
    const beatIndex = new Map<string, Interval>();
    const noteIndex = new Map<string, Interval>();
    let offset = 0;
    for (const m of track.measures) {
      const context = createMeasureRhythmContext(m);
      for (const beat of m.beats) {
        const duration = context.getBeatDurationTicks(beat);
        if (!duration.ok) continue;
        const point = { start: offset + beat.tick, end: offset + beat.tick + duration.ticks };
        beatIndex.set(beat.id, point);
        beat.notes.forEach(note => noteIndex.set(note.id, point));
      }
      offset += getMeasureCapacityTicks(m.timeSignature);
    }
    for (const mark of track.techniques) {
      const points = "fromNoteId" in mark ? [noteIndex.get(mark.fromNoteId), ...("toNoteId" in mark ? [noteIndex.get(mark.toNoteId)] : [])]
        : "beatId" in mark ? [beatIndex.get(mark.beatId)] : [beatIndex.get(mark.fromBeatId), beatIndex.get(mark.toBeatId)];
      affected(mark.id, mark.type, points);
    }
  }

  const ids = createDocumentIdFactory(document);
  const createId = () => numbered ? ids.createNumberedEventId() : ids.createBeatId();
  const empty = (id: string, tick: number, rhythm: ILXMRhythm, source?: RhythmPatternEvent): RhythmPatternEvent => numbered
    ? { id, tick, rhythm, kind: "gap", items: [] }
    : { id, tick, rhythm, kind: "notes", notes: [], ...(source && "notes" in source && source.preserveInputRhythm ? { preserveInputRhythm: true as const } : {}) };
  const outside: RhythmPatternEvent[] = [];
  const usedIds = new Set<string>();
  // 范围外对象原样共享；只有跨界纯空位需要拆成精确的时值。
  for (const event of source) {
    const bounds = eventInterval(event);
    if (!overlaps(bounds, interval)) { outside.push(event); usedIds.add(event.id); continue; }
    for (const [start, end] of [[bounds.start, Math.min(bounds.end, startTick)], [Math.max(bounds.start, endTick), bounds.end]]) {
      if (end! <= start!) continue;
      const split = createRestRhythmsForTicks(end! - start!);
      if (!split.ok) return fail("RHYTHM_NOT_REPRESENTABLE", "范围外空位无法精确分割，请扩大选区。");
      let tick = start!;
      for (const rhythm of split.rhythms) {
        const id = usedIds.has(event.id) ? createId() : event.id;
        outside.push(empty(id, tick, rhythm, event));
        usedIds.add(id);
        const duration = calculateRhythmTicks(rhythm);
        if (duration.ok) tick += duration.ticks;
      }
    }
  }
  const availableGaps = relevant.filter(event => !hasContent(event) && !usedIds.has(event.id));
  const perBeat: RhythmPatternBeatSummary[] = [];
  const after: RhythmPatternEvent[] = [];
  const discardedTextAnchors = new Set<string>();
  const textAnchors = numbered ? lyricIds : chordIds;
  for (let start = startTick; start < endTick; start += beatTicks) {
    // 每拍从前向后填入模板位置，多余内容留在该拍处理，不挪到邻拍。
    const before = relevant.filter(event => event.tick >= start && event.tick < start + beatTicks);
    const contents = before.filter(hasContent);
    const beatNumber = start / beatTicks + 1;
    const retained = contents.slice(0, chosen.rhythms.length);
    const discarded = contents.slice(chosen.rhythms.length);
    for (const event of discarded)
      if (textAnchors.has(event.id)) discardedTextAnchors.add(event.id);
    // TAB 纯横线按拍号分母固定占一个单位拍；普通时值命令也遵守此约束。
    // 在规划阶段就阻止不兼容模板，避免先展示可应用预览、提交时才发现结果不合法。
    const continuationRhythm = tabContinuationRhythm(measure);
    if (!numbered && retained.some((content, index) => "notes" in content &&
      isPureTabContinuationBeat(content) && (!continuationRhythm ||
        chosen.rhythms[index]!.base !== continuationRhythm.base ||
        chosen.rhythms[index]!.dots !== continuationRhythm.dots)))
      return fail("RHYTHM_PATTERN_FIXED_CONTINUATION", "六线谱延音横线须保持一个单位拍，请先改为普通音符或选择保留该时值的模板。");
    let tick = start;
    const events = chosen.rhythms.map((rhythm, index) => {
      const content = retained[index];
      let event: RhythmPatternEvent;
      if (content) event = { ...content, tick, rhythm: { ...rhythm } };
      else {
        const gap = availableGaps.find(g => !usedIds.has(g.id) && g.tick === tick) ?? availableGaps.find(g => !usedIds.has(g.id));
        const id = gap?.id ?? createId();
        event = empty(id, tick, { ...rhythm }, gap);
      }
      usedIds.add(event.id);
      tick += chosen.ticks[index]!;
      return event;
    });
    after.push(...events);
    perBeat.push({ beatNumber, startTick: start, endTick: start + beatTicks, retainedCount: retained.length, discardedCount: discarded.length, gapCount: events.length - retained.length, before, after: events });
  }
  const removedIds = new Set(removedMarks.map(mark => mark.id));
  const events = [...outside, ...after].sort((a, b) => a.tick - b.tick);
  const nextMeasure = numbered
    ? { ...measure, ...(discardedTextAnchors.size ? { lyrics: measure.lyrics.filter(lyric => !discardedTextAnchors.has(lyric.eventId)) } : {}),
        numberedVoice: { events: events as ILXMNumberedEvent[], tuplets: measure.numberedVoice.tuplets.filter(g => !removedIds.has(g.id)) } }
    : { ...measure, ...(discardedTextAnchors.size ? { chordSymbols: measure.chordSymbols.filter(chord => !discardedTextAnchors.has(chord.beatId)) } : {}),
        beats: events as ILXMBeat[], tuplets: measure.tuplets.filter(g => !removedIds.has(g.id)) };
  const discardedTextCount = numbered ? measure.lyrics.length - nextMeasure.lyrics.length
    : measure.chordSymbols.length - nextMeasure.chordSymbols.length;
  const nextTrack: ILXMTrack = { ...track,
    measures: track.measures.map(m => m === measure ? nextMeasure : m),
    numberedMarks: numbered ? track.numberedMarks.filter(m => !removedIds.has(m.id)) : track.numberedMarks,
    techniques: numbered ? track.techniques : track.techniques.filter(m => !removedIds.has(m.id)),
  };
  const changed = !semanticJsonEqual(track, nextTrack);
  // 先比较音乐结果，避免只为新增保护字段创建历史。新构造对象同时被
  // after/perBeat.after/nextMeasure引用，确认真正变化后才标记范围内空拍。
  if (changed && !numbered) {
    for (const event of after) {
      if ("notes" in event && event.kind === "notes" && !event.notes.length)
        event.preserveInputRhythm = true;
    }
  }
  const focusTick = Math.floor(target.focusTick / beatTicks) * beatTicks;
  const focusEvent = after.find(e => e.tick === (focusTick >= startTick && focusTick < endTick ? focusTick : startTick))!;
  return {
    ok: true, target: { ...target, startTick, endTick }, scope, template: chosen,
    before: relevant, after, beforeDurationTicks: Object.fromEntries(durations), perBeat, removedMarks, discardedTextCount,
    // 完整值比较避免散列碰撞；包括原始选区、所有文档内容和 revision。
    confirmationKey: JSON.stringify(["rhythm-pattern-v1", document, target, templateId]),
    track: changed ? nextTrack : track, changed,
    focus: { trackId: track.id, measureId: measure.id, tick: focusEvent.tick, endTick: focusEvent.tick + chosen.ticks[0]!, ...(numbered ? { eventId: focusEvent.id } : { beatId: focusEvent.id }) },
  };
};
