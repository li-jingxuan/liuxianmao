import { GUITAR_STRING_COUNT, LXM_RHYTHM_BASES, TICKS_PER_QUARTER } from "../constants";
import { createDocumentIdFactory, type ILXMIdFactory } from "../id-factory";
import { semanticJsonEqual } from "../document/score-tonality";
import { validateNumberedMarks } from "../numbered/numbered-marks";
import { buildNumberedIndex, createNumberedRhythmContext } from "../numbered/numbered-rhythm";
import { validateTechnique } from "../techniques/technique-rules";
import { sameTechniqueDraft } from "../techniques/technique-equality";
import { calculateRhythmTicks, createRestRhythmsForTicks, getMeasureDurationTicks } from "./rhythm";
import { createMeasureRhythmContext } from "./tuplet";
import { isPureTabContinuationBeat, tabContinuationRhythm } from "./tab-continuation";
import type { ILXMBeat, ILXMDocument, ILXMMeasure, ILXMNumberedEvent, ILXMRhythm, ILXMStrokeDirection, ILXMTechnique, ILXMTimeSignature, ILXMTrack } from "../types";

export interface RhythmPatternTarget {
  layer: "numbered" | "tab";
  trackId: string;
  measureId: string;
  endMeasureId?: string;
  focusMeasureId?: string;
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
  template("split-first-eighth", "首个八分细分", [1, 1, 2, 2]),
  template("split-middle-eighth", "中间八分细分", [2, 1, 1, 2]),
  template("split-last-eighth", "末个八分细分", [2, 2, 1, 1]),
  template("dotted-eight-sixteen-eight", "附点八＋十六＋八", [3, 1, 2]),
]);
export const getRhythmPatternTemplates = (signature: ILXMTimeSignature): readonly RhythmPatternTemplate[] => {
  const ticks = signature.denominator === 4 && [3, 4].includes(signature.numerator)
    ? TICKS_PER_QUARTER
    : signature.denominator === 8 && signature.numerator === 6 ? TICKS_PER_QUARTER * 1.5 : 0;
  return RHYTHM_PATTERN_TEMPLATES.filter(item => item.beatTicks === ticks);
};

export interface MeasureRhythmPatternTemplate {
  readonly id: string;
  readonly name: string;
  readonly beats: readonly RhythmPatternTemplate[];
  readonly collapsed?: true;
}

const beatTemplatesById = new Map(RHYTHM_PATTERN_TEMPLATES.map((beat) => [beat.id, beat]));
const measureTemplate = (
  id: string,
  name: string,
  beatIds: readonly string[],
  collapsed?: true,
): MeasureRhythmPatternTemplate => Object.freeze({
  id,
  name,
  beats: Object.freeze(beatIds.map((beatId) => beatTemplatesById.get(beatId)!)),
  ...(collapsed ? { collapsed } : {}),
});

const measureTemplatesByMeter: Readonly<Record<string, readonly MeasureRhythmPatternTemplate[]>> = {
  "4/4": Object.freeze([
    measureTemplate("measure-44-alternating", "交替分解", ["eight-sixteen", "sixteenths", "eight-sixteen", "sixteenths"]),
    measureTemplate("measure-44-mirrored", "前后十六交替", ["eight-sixteen", "sixteen-eight", "eight-sixteen", "sixteen-eight"]),
    measureTemplate("measure-44-quarter-split", "四分与分解", ["quarter", "eight-sixteen", "quarter", "eight-sixteen"]),
    measureTemplate("measure-44-eighths", "均匀八分", ["eighths", "eighths", "eighths", "eighths"]),
    measureTemplate("measure-44-sixteenths", "均匀十六分", ["sixteenths", "sixteenths", "sixteenths", "sixteenths"]),
    measureTemplate("measure-44-eighth-sixteenth", "八十六交替", ["eighths", "sixteenths", "eighths", "sixteenths"]),
    measureTemplate("measure-44-quarter-eighth", "四八交替", ["quarter", "eighths", "quarter", "eighths"], true),
    measureTemplate("measure-44-dotted", "附点推进", ["dotted-eight", "eighths", "dotted-eight", "eighths"], true),
    measureTemplate("measure-44-mirrored-dotted", "正反附点", ["dotted-eight", "reverse-dotted", "dotted-eight", "reverse-dotted"], true),
    measureTemplate("measure-44-syncopated", "切分交替", ["eighths", "small-syncopation", "eighths", "small-syncopation"], true),
    measureTemplate("measure-44-building", "先疏后密", ["quarter", "eighths", "eight-sixteen", "sixteenths"], true),
    measureTemplate("measure-44-dense-end", "后半段加密", ["eighths", "eighths", "sixteenths", "sixteenths"], true),
    measureTemplate("measure-44-closing", "四拍收束", ["eighths", "eight-sixteen", "sixteenths", "quarter"], true),
    measureTemplate("measure-44-quarters", "均匀四分", ["quarter", "quarter", "quarter", "quarter"], true),
  ]),
  "3/4": Object.freeze([
    measureTemplate("measure-34-quarter-first", "首拍四分", ["quarter", "eighths", "eighths"]),
    measureTemplate("measure-34-alternating", "交替分解", ["eight-sixteen", "sixteenths", "eight-sixteen"]),
    measureTemplate("measure-34-mirrored", "前后十六交替", ["eight-sixteen", "sixteen-eight", "eight-sixteen"]),
    measureTemplate("measure-34-eighths", "均匀八分", ["eighths", "eighths", "eighths"]),
    measureTemplate("measure-34-sixteenths", "均匀十六分", ["sixteenths", "sixteenths", "sixteenths"]),
    measureTemplate("measure-34-dense-end", "末拍细分", ["eighths", "eighths", "sixteenths"]),
    measureTemplate("measure-34-dotted", "首拍附点", ["dotted-eight", "eighths", "eighths"]),
    measureTemplate("measure-34-syncopated", "中拍切分", ["quarter", "small-syncopation", "eighths"]),
    measureTemplate("measure-34-building", "先疏后密", ["quarter", "eighths", "eight-sixteen"]),
    measureTemplate("measure-34-quarters", "均匀四分", ["quarter", "quarter", "quarter"]),
  ]),
  "6/8": Object.freeze([
    measureTemplate("measure-68-eighths", "均匀八分", ["three-eighths", "three-eighths"]),
    measureTemplate("measure-68-alternating", "长短交替", ["quarter-eight", "eight-quarter"]),
    measureTemplate("measure-68-dotted-first", "首拍附点四分", ["dotted-quarter", "three-eighths"]),
    measureTemplate("measure-68-dotted-last", "末拍附点四分", ["three-eighths", "dotted-quarter"]),
    measureTemplate("measure-68-dotted-quarters", "均匀附点四分", ["dotted-quarter", "dotted-quarter"]),
    measureTemplate("measure-68-sixteenths", "均匀十六分", ["six-sixteenths", "six-sixteenths"]),
    measureTemplate("measure-68-dense-end", "末拍十六分", ["three-eighths", "six-sixteenths"]),
    measureTemplate("measure-68-split-edges", "首末细分", ["split-first-eighth", "split-last-eighth"]),
    measureTemplate("measure-68-split-middle", "中间细分", ["split-middle-eighth", "split-middle-eighth"]),
    measureTemplate("measure-68-dotted", "附点推进", ["dotted-eight-sixteen-eight", "three-eighths"]),
  ]),
};

export const getMeasureRhythmPatternTemplates = ({ numerator, denominator }: ILXMTimeSignature): readonly MeasureRhythmPatternTemplate[] =>
  measureTemplatesByMeter[`${numerator}/${denominator}`] ?? [];

export interface StrumRhythmPatternTemplate {
  readonly id: string;
  readonly name: string;
  /** Eight eighth-note slots. A null slot sustains the preceding stroke. */
  readonly strokes: readonly (ILXMStrokeDirection | null)[];
}

const strumTemplate = (id: string, name: string, slots: string): StrumRhythmPatternTemplate => Object.freeze({
  id: `strum-${id}`,
  name,
  strokes: Object.freeze([...slots].map(slot => slot === "上" ? "up" : slot === "下" ? "down" : null)),
});
const strumTemplates = Object.freeze([
  strumTemplate("up-up-down", "上上下", "上·上·下···"),
  strumTemplate("up-down-up-down", "上下上下", "上·下·上·下·"),
  strumTemplate("down-hold-down-up", "下-下上", "下···下上··"),
  strumTemplate("down-hold-down-down-up", "下-下下上", "下···下·下上"),
  strumTemplate("down-down-up", "下下上", "下·下·上···"),
  strumTemplate("down-up-down", "下上下", "下·上·下···"),
  strumTemplate("down-up-down-up", "下上下上", "下·上·下·上·"),
  strumTemplate("down-hold-up", "下上", "下···上···"),
]);

export const getStrumRhythmPatternTemplates = ({ numerator, denominator }: ILXMTimeSignature): readonly StrumRhythmPatternTemplate[] =>
  numerator === 4 && denominator === 4 ? strumTemplates : [];

export interface BeatStrumRhythmPatternTemplate {
  readonly id: string;
  readonly name: string;
  readonly form: string;
  /** Four sixteenth-note slots. A null slot sustains the preceding stroke. */
  readonly strokes: readonly (ILXMStrokeDirection | null)[];
}

const beatStrumTemplate = (id: string, name: string, formId: string): BeatStrumRhythmPatternTemplate => {
  const { name: form, values } = beatTemplatesById.get(formId)!;
  const strokes = values.flatMap((length, index) => [
    name[index] === "上" ? "up" as const : "down" as const,
    ...Array<null>(length - 1).fill(null),
  ]);
  return Object.freeze({ id: `beat-strum-${id}`, name, form, strokes: Object.freeze(strokes) });
};

const beatStrumTemplates = Object.freeze([
  // 收起时只显示参考图标号 1–6 的常用模板。未标号的模板按原顺序接在其后。
  beatStrumTemplate("d", "下", "quarter"),
  beatStrumTemplate("ddu", "下下上", "eight-sixteen"),
  beatStrumTemplate("dudu", "下上下上", "sixteenths"),
  beatStrumTemplate("dud", "下上下", "sixteen-eight"),
  beatStrumTemplate("du", "下上", "eighths"),
  beatStrumTemplate("dud-sync", "下上下", "small-syncopation"),
  beatStrumTemplate("uud", "上上下", "eight-sixteen"),
  beatStrumTemplate("udud", "上下上下", "sixteenths"),
  beatStrumTemplate("ud", "上下", "eighths"),
  beatStrumTemplate("uud-short", "上上下", "sixteen-eight"),
  beatStrumTemplate("du-dotted", "下上", "dotted-eight"),
  beatStrumTemplate("ud-dotted", "上下", "reverse-dotted"),
]);

export const getBeatStrumRhythmPatternTemplates = ({ numerator, denominator }: ILXMTimeSignature): readonly BeatStrumRhythmPatternTemplate[] =>
  denominator === 4 && (numerator === 3 || numerator === 4) ? beatStrumTemplates : [];

export type RhythmPatternEvent = ILXMBeat | ILXMNumberedEvent;
export interface RhythmPatternScope {
  startTick: number;
  endTick: number;
  beatTicks: number;
  beatCount: number;
  firstBeat: number;
  lastBeat: number;
}

export function getRhythmPatternMeasureRanges(track: ILXMTrack, target: RhythmPatternTarget) {
  const first = track.measures.findIndex(measure => measure.id === target.measureId);
  const last = target.endMeasureId === undefined ? first : track.measures.findIndex(measure => measure.id === target.endMeasureId);
  const focus = target.focusMeasureId === undefined ? first : track.measures.findIndex(measure => measure.id === target.focusMeasureId);
  if (first < 0 || last < first || focus < first || focus > last) return [];

  return track.measures.slice(first, last + 1).map((measure, index) => {
    const capacity = getMeasureDurationTicks(measure);
    const startTick = index === 0 ? target.startTick : 0;
    const endTick = first + index === last ? target.endTick : capacity;
    return { measure, startTick, endTick, capacity, focusTick: first + index === focus ? target.focusTick : startTick, index: first + index };
  });
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
export type RhythmPatternErrorCode = "INVALID_RHYTHM_PATTERN_TARGET" | "UNSUPPORTED_TIME_SIGNATURE" | "RHYTHM_PATTERN_TEMPLATE_MISMATCH" | "RHYTHM_PATTERN_CROSSING_CONTENT" | "RHYTHM_PATTERN_PARTIAL_TUPLET" | "RHYTHM_PATTERN_FIXED_CONTINUATION" | "RHYTHM_NOT_REPRESENTABLE" | "STRUM_PATTERN_MISSING_VOICING" | "STRUM_PATTERN_CHORD_CHANGE";
export type RhythmPatternPlan = {
  ok: true;
  target: RhythmPatternTarget;
  scope: RhythmPatternScope;
  scopes: (RhythmPatternScope & { measureId: string })[];
  template: RhythmPatternTemplate | MeasureRhythmPatternTemplate | StrumRhythmPatternTemplate | BeatStrumRhythmPatternTemplate;
  before: RhythmPatternEvent[];
  after: RhythmPatternEvent[];
  /** 原连音的实际时值，预览不能只用书写 rhythm 推算。 */
  beforeDurationTicks: Record<string, number>;
  perBeat: RhythmPatternBeatSummary[];
  removedMarks: RhythmPatternRemovedMark[];
  discardedTextCount: number;
  requiresConfirmation: boolean;
  confirmationKey: string;
  track: ILXMTrack;
  changed: boolean;
  focus: { trackId: string; measureId: string; tick: number; endTick: number; eventId?: string; beatId?: string };
} | { ok: false; code: RhythmPatternErrorCode; message: string };

const markNames: Record<string, string> = {
  tie: "延音线", traversalTie: "扫弦/琶音延音线", slur: "圆滑线", fermata: "延长记号", tuplet: "连音组",
  bend: "推弦", vibrato: "揉弦", naturalHarmonic: "自然泛音", artificialHarmonic: "人工泛音",
  tapping: "点弦", trill: "颤音", hammerOn: "击弦", pullOff: "勾弦", slideUp: "上滑音", slideDown: "下滑音",
  strum: "扫弦", arpeggio: "琶音", pickStroke: "拨片方向", palmMute: "掌根闷音", letRing: "持续发声",
};
interface Interval { start: number; end: number }
const overlaps = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;

/** 按焦点所在的完整演奏拍识别节奏；空位和休止同样参与，缺口或跨拍事件不猜测。 */
export const inferRhythmPatternTemplate = (document: ILXMDocument, target: RhythmPatternTarget): RhythmPatternTemplate | null => {
  const track = document.score.tracks.find(item => item.id === target.trackId);
  const ranges = track ? getRhythmPatternMeasureRanges(track, target) : [];
  const focus = ranges.find(range => range.measure.id === (target.focusMeasureId ?? target.measureId));
  const measure = focus?.measure;
  if (!measure || !["numbered", "tab"].includes(target.layer)) return null;
  const templates = getRhythmPatternTemplates(measure.timeSignature);
  const beatTicks = templates[0]?.beatTicks;
  const capacity = getMeasureDurationTicks(measure);
  if (!beatTicks || ![focus.startTick, focus.endTick, target.focusTick].every(Number.isInteger) ||
      focus.startTick < 0 || focus.endTick < focus.startTick || focus.endTick > capacity ||
      focus.startTick >= capacity || target.focusTick < 0 || target.focusTick >= capacity) return null;
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

const fail = (code: RhythmPatternErrorCode, message: string) => ({ ok: false as const, code, message });

type MeasureRange = ReturnType<typeof getRhythmPatternMeasureRanges>[number];
const describeMeasure = ({ index, measure }: MeasureRange) =>
  `第 ${index + 1} 小节（${measure.timeSignature.numerator}/${measure.timeSignature.denominator}）`;

const isValidMeasureRange = ({ startTick, endTick, focusTick, capacity }: MeasureRange, multiMeasure: boolean) =>
  [startTick, endTick, focusTick].every(Number.isInteger) && startTick >= 0 && startTick < capacity &&
  endTick >= startTick && endTick <= capacity && focusTick >= 0 && focusTick < capacity &&
  (!multiMeasure || endTick > startTick);

type StrumTechnique = Extract<ILXMTechnique, { type: "strum" }>;
const getStrumAttacks = (template: StrumRhythmPatternTemplate, startTick: number, slotTicks: number) =>
  template.strokes.flatMap((stroke, slot) => stroke ? [{ stroke, tick: startTick + slot * slotTicks }] : []);

const matchesStrumVoicing = (beat: ILXMBeat | undefined, voicing: ILXMBeat["notes"]): beat is ILXMBeat =>
  beat?.kind === "notes" && beat.notes.length === voicing.length &&
  voicing.every(note => beat.notes.some(candidate => candidate.string === note.string && candidate.fret === note.fret));

const strumDraft = (beatId: string, stroke: ILXMStrokeDirection, voicing: ILXMBeat["notes"]): Omit<StrumTechnique, "id"> => ({
  type: "strum", beatId, stroke, showFrets: true,
  minString: Math.min(...voicing.map(note => note.string)),
  maxString: Math.max(...voicing.map(note => note.string)),
});

const beatStrumDraft = (beatId: string, stroke: ILXMStrokeDirection, voicing: ILXMBeat["notes"]): Omit<StrumTechnique, "id"> =>
  voicing.length ? strumDraft(beatId, stroke, voicing)
    : { type: "strum", beatId, stroke, minString: 1, maxString: GUITAR_STRING_COUNT };

function matchBeatStrumTemplate(
  beats: readonly ILXMBeat[],
  startTick: number,
  oldStrums: ReadonlyMap<string, StrumTechnique>,
): BeatStrumRhythmPatternTemplate | null {
  const voicing = beats[0]?.notes;
  if (!voicing || voicing.length === 1 || voicing.some(note => note.fret === "-")) return null;
  const slotTicks = TICKS_PER_QUARTER / 4;
  const strokes: (ILXMStrokeDirection | null)[] = [null, null, null, null];
  let slot = 0;
  for (const beat of beats) {
    const mark = oldStrums.get(beat.id);
    const matches = voicing.length ? matchesStrumVoicing(beat, voicing) : beat.kind === "rest" && !beat.notes.length;
    if (slot >= strokes.length || beat.tick !== startTick + slot * slotTicks || !matches ||
        !mark || !sameTechniqueDraft(mark, beatStrumDraft(beat.id, mark.stroke, voicing))) return null;
    const duration = calculateRhythmTicks(beat.rhythm);
    if (!duration.ok || duration.ticks % slotTicks !== 0) return null;
    strokes[slot] = mark.stroke;
    slot += duration.ticks / slotTicks;
  }
  if (slot !== strokes.length) return null;
  return beatStrumTemplates.find(template => template.strokes.every((stroke, index) => stroke === strokes[index])) ?? null;
}

function strumsByBeatId(track: ILXMTrack, beatIds?: ReadonlySet<string>): Map<string, StrumTechnique> {
  const strums = new Map<string, StrumTechnique>();
  for (const mark of track.techniques) {
    if (mark.type !== "strum" || (beatIds && !beatIds.has(mark.beatId))) continue;
    strums.set(mark.beatId, mark);
    if (beatIds && strums.size === beatIds.size) break;
  }
  return strums;
}

const getBeatStrumScopeStart = (range: MeasureRange): number | undefined => {
  if (!isValidMeasureRange(range, false)) return;
  const startTick = Math.floor(range.focusTick / TICKS_PER_QUARTER) * TICKS_PER_QUARTER;
  const endTick = startTick + TICKS_PER_QUARTER;
  // 短小节的最后一段可能不足完整四分拍，不能生成越过小节边界的扫弦计划。
  if (endTick > range.capacity) return;
  if (range.startTick >= startTick && range.startTick < endTick && range.endTick <= endTick) return startTick;
};

/** Recognize the selected beat's stored TAB strokes without constructing or validating an edit. */
export function inferBeatStrumRhythmPatternTemplate(document: ILXMDocument, target: RhythmPatternTarget): BeatStrumRhythmPatternTemplate | null {
  if (target.layer !== "tab" || (target.endMeasureId ?? target.measureId) !== target.measureId ||
      (target.focusMeasureId ?? target.measureId) !== target.measureId) return null;
  const track = document.score.tracks.find(item => item.id === target.trackId);
  if (!track) return null;
  const [range] = getRhythmPatternMeasureRanges(track, target);
  if (!range || !getBeatStrumRhythmPatternTemplates(range.measure.timeSignature).length) return null;
  const startTick = getBeatStrumScopeStart(range);
  if (startTick === undefined) return null;
  const { measure } = range;
  const first = measure.beats.findIndex(beat => beat.tick >= startTick);
  if (first < 0 || measure.beats[first]!.tick !== startTick) return null;
  const endTick = startTick + TICKS_PER_QUARTER;
  const beats: ILXMBeat[] = [];
  for (let index = first; index < measure.beats.length && measure.beats[index]!.tick < endTick; index++) {
    beats.push(measure.beats[index]!);
    if (beats.length > 4) return null;
  }
  const beatIds = new Set(beats.map(beat => beat.id));
  if (measure.tuplets.some(group => group.beatIds.some(id => beatIds.has(id)))) return null;
  return matchBeatStrumTemplate(beats, startTick, strumsByBeatId(track, beatIds));
}

const strumRhythms: readonly (ILXMRhythm | undefined)[] = [undefined,
  { base: "eighth", dots: 0 }, { base: "quarter", dots: 0 },
  { base: "quarter", dots: 1 }, { base: "half", dots: 0 },
];

function planMeasureStrumPattern(range: MeasureRange, template: StrumRhythmPatternTemplate, ids: ILXMIdFactory) {
  const { measure, capacity, focusTick } = range;
  const beatTicks = TICKS_PER_QUARTER;
  if (capacity !== beatTicks * 4)
    return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", "整小节扫弦模板需要四个完整四分拍，当前小节时长不兼容。");
  const source = measure.beats;
  const firstBeat = source[0];
  const voicing = firstBeat?.tick === 0 && firstBeat.kind === "notes"
    ? firstBeat.notes.filter(note => note.fret !== "-") : [];
  if (!firstBeat || new Set(voicing.map(note => note.string)).size < 2)
    return fail("STRUM_PATTERN_MISSING_VOICING", "首拍至少需要两根有起音的弦，请先补齐首拍音组。");
  if (measure.chordSymbols.some(chord => chord.beatId !== firstBeat.id))
    return fail("STRUM_PATTERN_CHORD_CHANGE", "小节内首拍之后有和弦标记，请调整选区或和弦位置。");

  const context = createMeasureRhythmContext(measure);
  const durations = new Map<string, number>();
  let previousEnd = 0;
  for (const beat of source) {
    const duration = context.getBeatDurationTicks(beat);
    if (!duration.ok) return fail("RHYTHM_NOT_REPRESENTABLE", "原 TAB 实际时值无法精确表示。");
    if (beat.tick !== previousEnd || beat.tick + duration.ticks > capacity)
      return fail("RHYTHM_PATTERN_CROSSING_CONTENT", "原 TAB 节奏无法安全覆盖，请先修正小节内的时值。");
    durations.set(beat.id, duration.ticks);
    previousEnd = beat.tick + duration.ticks;
  }
  if (previousEnd !== capacity || measure.tuplets.some(group => group.beatIds.some(id => !durations.has(id))))
    return fail("RHYTHM_PATTERN_CROSSING_CONTENT", "原 TAB 节奏或连音组无法安全覆盖，请先修正小节结构。");

  const slotTicks = TICKS_PER_QUARTER / 2;
  const attacks = getStrumAttacks(template, 0, slotTicks);
  const byTick = new Map(source.map(beat => [beat.tick, beat]));
  const retained = new Set<string>();
  const techniques: Omit<StrumTechnique, "id">[] = [];
  const after: ILXMBeat[] = [];
  for (const [index, { stroke, tick }] of attacks.entries()) {
    const ticks = (attacks[index + 1]?.tick ?? capacity) - tick;
    const rhythm = strumRhythms[ticks / slotTicks];
    if (!rhythm) return fail("RHYTHM_NOT_REPRESENTABLE", "扫弦时值无法精确表示。");
    const original = byTick.get(tick);
    const sameVoicing = matchesStrumVoicing(original, voicing);
    const beatId = tick === 0 || sameVoicing ? original!.id : ids.createBeatId();
    if (sameVoicing) retained.add(beatId);
    const notes = sameVoicing ? original.notes : tick === 0 ? voicing : voicing.map(note => ({ ...note, id: ids.createNoteId() }));
    after.push({ id: beatId, tick, rhythm: { ...rhythm }, kind: "notes", notes });
    techniques.push(strumDraft(beatId, stroke, voicing));
  }

  const perBeat: RhythmPatternBeatSummary[] = Array.from({ length: 4 }, (_, index) => {
    const startTick = index * beatTicks;
    const endTick = startTick + beatTicks;
    const before = source.filter(beat => beat.tick >= startTick && beat.tick < endTick);
    const kept = before.filter(beat => retained.has(beat.id));
    return { beatNumber: index + 1, startTick, endTick, before,
      after: after.filter(beat => beat.tick >= startTick && beat.tick < endTick), retainedCount: kept.length,
      discardedCount: before.filter(beat => (beat.kind === "rest" || beat.notes.length) && !retained.has(beat.id)).length, gapCount: 0 };
  });
  const nextAttackIndex = after.findIndex(beat => beat.tick > focusTick);
  const focusBeat = after.at(nextAttackIndex < 0 ? -1 : nextAttackIndex - 1)!;
  const endTick = nextAttackIndex < 0 ? capacity : after[nextAttackIndex]!.tick;
  return {
    ok: true as const, measure: { ...measure, beats: after, tuplets: [] },
    scope: { measureId: measure.id, startTick: 0, endTick: capacity, beatTicks, beatCount: 4, firstBeat: 1, lastBeat: 4 },
    before: source, after, durations, perBeat, techniques,
    removedMarks: measure.tuplets.map(({ id }) => ({ id, type: "tuplet", name: markNames.tuplet!, crossesScope: false })),
    discardedTextCount: 0,
    focus: { measureId: measure.id, tick: focusBeat.tick, endTick, beatId: focusBeat.id },
  };
}

function splitBeatStrumRemainder(beat: ILXMBeat, start: number, end: number, ids: ILXMIdFactory) {
  const ticks = end - start;
  const exact = LXM_RHYTHM_BASES.flatMap(base => [0, 1, 2].map(dots => ({ base, dots }))).find(rhythm => {
    const duration = calculateRhythmTicks(rhythm);
    return duration.ok && duration.ticks === ticks;
  });
  const split = exact ? { ok: true as const, rhythms: [exact] } : createRestRhythmsForTicks(ticks);
  if (!split.ok) return;
  const beats: ILXMBeat[] = [];
  const ties: ILXMTechnique[] = [];
  let tick = start;
  for (const rhythm of split.rhythms) {
    // The original attack and its anchors stay on the left. The right starts at the beat boundary.
    const fragment = tick === beat.tick ? { ...beat, rhythm } : {
      ...beat, id: ids.createBeatId(), tick, rhythm,
      notes: beat.notes.map(note => ({ ...note, id: ids.createNoteId() })),
    };
    const previous = beats.at(-1);
    if (previous) {
      for (const [index, note] of previous.notes.entries()) {
        ties.push({ id: ids.createTechniqueId(), type: "tie", fromNoteId: note.id, toNoteId: fragment.notes[index]!.id });
      }
    }
    beats.push(fragment);
    const duration = calculateRhythmTicks(rhythm);
    if (duration.ok) tick += duration.ticks;
  }
  return { beats, ties };
}

function planBeatStrumPattern(
  range: MeasureRange,
  template: BeatStrumRhythmPatternTemplate,
  ids: ILXMIdFactory,
  oldStrums: ReadonlyMap<string, StrumTechnique>,
) {
  const { measure, focusTick } = range;
  const beatTicks = TICKS_PER_QUARTER;
  const slotTicks = beatTicks / 4;
  const startTick = getBeatStrumScopeStart(range);
  if (startTick === undefined)
    return fail("INVALID_RHYTHM_PATTERN_TARGET", "请在六线谱中选择一拍。");
  const endTick = startTick + beatTicks;

  const context = createMeasureRhythmContext(measure);
  const durations = new Map<string, number>();
  const before: ILXMBeat[] = [];
  for (const beat of measure.beats) {
    if (beat.tick >= endTick) break;
    const duration = context.getBeatDurationTicks(beat);
    if (!duration.ok) return fail("RHYTHM_NOT_REPRESENTABLE", "原 TAB 实际时值无法精确表示。");
    if (beat.tick + duration.ticks <= startTick) continue;
    before.push(beat);
    durations.set(beat.id, duration.ticks);
  }
  const tuplets = measure.tuplets.filter(group => group.beatIds.some(id => durations.has(id)));
  const crossingBeats = before.filter(beat => beat.tick < startTick || beat.tick + durations.get(beat.id)! > endTick);
  const crossingIds = new Set(crossingBeats.map(beat => beat.id));
  if (tuplets.some(group => group.beatIds.some(id => !durations.has(id) || crossingIds.has(id))))
    return fail("RHYTHM_PATTERN_PARTIAL_TUPLET", "目标只包含部分连音组，请选择完整的一拍。");
  const leading: ILXMBeat[] = [];
  const trailing: ILXMBeat[] = [];
  const ties: ILXMTechnique[] = [];
  for (const beat of crossingBeats) {
    if (beat.notes.some(note => note.fret === "-"))
      return fail("RHYTHM_PATTERN_CROSSING_CONTENT", "跨出这一拍的 TAB 延音无法分割，请先调整延音。");
    for (const [fragments, start, end] of [
      [leading, beat.tick, startTick], [trailing, endTick, beat.tick + durations.get(beat.id)!],
    ] as const) {
      if (end <= start) continue;
      const remainder = splitBeatStrumRemainder(beat, start, end, ids);
      if (!remainder) return fail("RHYTHM_NOT_REPRESENTABLE", "拍外的 TAB 时值无法精确分割，请先调整时值。");
      fragments.push(...remainder.beats);
      ties.push(...remainder.ties);
    }
  }
  const firstNotes = before[0]?.notes.filter(note => note.fret !== "-") ?? [];
  const voicing = firstNotes.length >= 2 ? firstNotes : [];

  // Recognize complete existing templates so their repeated strokes can be replaced as a unit.
  const existingTemplate = !tuplets.length && matchBeatStrumTemplate(before, startTick, oldStrums);
  const alreadyApplied = existingTemplate === template;
  const byTick = new Map(before.map(beat => [beat.tick, beat]));
  const attacks = getStrumAttacks(template, startTick, slotTicks);
  const after: ILXMBeat[] = alreadyApplied ? before : attacks.map(({ tick }, index) => {
    const rhythm = rhythmForValue(((attacks[index + 1]?.tick ?? endTick) - tick) / slotTicks);
    const original = byTick.get(tick);
    if (voicing.length && matchesStrumVoicing(original, voicing)) return { ...original, rhythm };
    if (!voicing.length && original?.kind === "rest") return { ...original, rhythm };
    return {
      id: original?.id ?? ids.createBeatId(), tick, rhythm, kind: voicing.length ? "notes" : "rest",
      notes: voicing.map(note => ({ ...note, id: ids.createNoteId() })),
    };
  });
  const retainedIds = new Set(after.map(beat => beat.id));
  const replacedIds = new Set(before.filter(beat => beat.tick >= startTick && !retainedIds.has(beat.id)).map(beat => beat.id));
  const retainedContentIds = new Set(after.filter(beat => {
    const original = byTick.get(beat.tick);
    return original?.kind === beat.kind && original.notes === beat.notes;
  }).map(beat => beat.id));
  const discardedCount = existingTemplate ? 0 : before.filter(beat => beat.tick >= startTick &&
    (beat.kind === "rest" || beat.notes.length > 0) && !retainedContentIds.has(beat.id)).length;
  const chordSymbols = measure.chordSymbols.some(chord => replacedIds.has(chord.beatId))
    ? measure.chordSymbols.filter(chord => !replacedIds.has(chord.beatId)) : measure.chordSymbols;

  const beatNumber = startTick / beatTicks + 1;
  const removedTupletIds = new Set(tuplets.map(tuplet => tuplet.id));
  const nextAttackIndex = after.findIndex(beat => beat.tick > focusTick);
  const focusBeat = after.at(nextAttackIndex < 0 ? -1 : nextAttackIndex - 1)!;
  return {
    ok: true as const,
    measure: alreadyApplied ? measure : { ...measure, beats: [
      ...measure.beats.filter(beat => beat.tick < startTick && !crossingIds.has(beat.id)), ...leading, ...after, ...trailing,
      ...measure.beats.filter(beat => beat.tick >= endTick),
    ], chordSymbols, tuplets: removedTupletIds.size ? measure.tuplets.filter(group => !removedTupletIds.has(group.id)) : measure.tuplets },
    scope: { measureId: measure.id, startTick, endTick, beatTicks, beatCount: 1, firstBeat: beatNumber, lastBeat: beatNumber },
    before, after, durations,
    techniques: attacks.map(({ stroke }, index) => beatStrumDraft(after[index]!.id, stroke, voicing)), ties,
    alreadyApplied,
    replacedStrumIds: existingTemplate ? before.map(beat => oldStrums.get(beat.id)!.id) : [],
    perBeat: [{ beatNumber, startTick, endTick, before, after, retainedCount: retainedContentIds.size, discardedCount, gapCount: 0 }],
    removedMarks: tuplets.map(({ id }) => ({ id, type: "tuplet", name: markNames.tuplet!, crossesScope: false })),
    discardedTextCount: measure.chordSymbols.length - chordSymbols.length,
    focus: { measureId: measure.id, tick: focusBeat.tick, endTick: after[nextAttackIndex]?.tick ?? endTick, beatId: focusBeat.id },
  };
}

function planMeasureRhythmPattern(
  range: MeasureRange,
  chosen: RhythmPatternTemplate | MeasureRhythmPatternTemplate,
  beatTicks: number,
  multiMeasure: boolean,
  numbered: boolean,
  createId: () => string,
) {
  const { measure, capacity, startTick: rawStart, endTick: rawEnd, focusTick: rawFocus } = range;
  if (!isValidMeasureRange(range, multiMeasure))
    return fail("INVALID_RHYTHM_PATTERN_TARGET", "选区或焦点已失效，请重新选择谱面位置。");
  const measureBeats = "beats" in chosen ? chosen.beats : undefined;
  // 短选区按焦点落入的演奏拍处理；连续多拍才向外归齐。6/8 的演奏拍为附点四分，
  // 不按拍号分母拆成三个互相独立的八分拍，避免预览范围与实际提交不一致。
  const short = !multiMeasure && rawEnd - rawStart < beatTicks;
  const startTick = measureBeats ? 0 : Math.floor((short ? rawFocus : rawStart) / beatTicks) * beatTicks;
  const endTick = measureBeats ? capacity : short ? startTick + beatTicks : Math.ceil(rawEnd / beatTicks) * beatTicks;
  // 预览阶段就拒绝不完整的演奏拍或超过实际小节时长的归齐范围。
  // 这样后续模板展开不会创建越过小节边界的事件。
  if (endTick > capacity || startTick >= endTick || (measureBeats && endTick !== capacity))
    return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", "当前模板需要完整且不越界的演奏拍，请缩小选区或选择兼容小节时长的模板。");
  if (measureBeats && measureBeats.reduce((ticks, item) => ticks + item.beatTicks, 0) !== capacity)
    return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", "整小节模板与当前小节实际时长不兼容。");
  const scope: RhythmPatternScope = { startTick, endTick, beatTicks, beatCount: (endTick - startTick) / beatTicks, firstBeat: startTick / beatTicks + 1, lastBeat: endTick / beatTicks };
  const interval = { start: startTick, end: endTick };
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
  const continuationRhythm = tabContinuationRhythm(measure);
  for (let start = startTick; start < endTick; start += beatTicks) {
    // 每拍从前向后填入模板位置，多余内容留在该拍处理，不挪到邻拍。
    const before = relevant.filter(event => event.tick >= start && event.tick < start + beatTicks);
    const contents = before.filter(hasContent);
    const beatNumber = start / beatTicks + 1;
    const beatTemplate = "beats" in chosen ? chosen.beats[beatNumber - 1]! : chosen;
    const retained = contents.slice(0, beatTemplate.rhythms.length);
    const discarded = contents.slice(beatTemplate.rhythms.length);
    for (const event of discarded)
      if (textAnchors.has(event.id)) discardedTextAnchors.add(event.id);
    // TAB 纯横线按拍号分母固定占一个单位拍；普通时值命令也遵守此约束。
    // 在规划阶段就阻止不兼容模板，避免先展示可应用预览、提交时才发现结果不合法。
    if (!numbered && retained.some((content, index) => "notes" in content &&
      isPureTabContinuationBeat(content) && (!continuationRhythm ||
        beatTemplate.rhythms[index]!.base !== continuationRhythm.base ||
        beatTemplate.rhythms[index]!.dots !== continuationRhythm.dots)))
      return fail("RHYTHM_PATTERN_FIXED_CONTINUATION", "六线谱延音横线须保持一个单位拍，请先改为普通音符或选择保留该时值的模板。");
    let tick = start;
    const events = beatTemplate.rhythms.map((rhythm, index) => {
      const content = retained[index];
      let event: RhythmPatternEvent;
      if (content) event = { ...content, tick, rhythm: { ...rhythm } };
      else {
        const gap = availableGaps.find(g => !usedIds.has(g.id) && g.tick === tick) ?? availableGaps.find(g => !usedIds.has(g.id));
        const id = gap?.id ?? createId();
        event = empty(id, tick, { ...rhythm }, gap);
      }
      usedIds.add(event.id);
      tick += beatTemplate.ticks[index]!;
      return event;
    });
    after.push(...events);
    perBeat.push({ beatNumber, startTick: start, endTick: start + beatTicks, retainedCount: retained.length, discardedCount: discarded.length, gapCount: events.length - retained.length, before, after: events });
  }
  const removedTupletIds = new Set(removedMarks.map(mark => mark.id));
  const events = [...outside, ...after].sort((a, b) => a.tick - b.tick);
  const nextMeasure: ILXMMeasure = numbered
    ? { ...measure, ...(discardedTextAnchors.size ? { lyrics: measure.lyrics.filter(lyric => !discardedTextAnchors.has(lyric.eventId)) } : {}),
        numberedVoice: { events: events as ILXMNumberedEvent[], tuplets: measure.numberedVoice.tuplets.filter(g => !removedTupletIds.has(g.id)) } }
    : { ...measure, ...(discardedTextAnchors.size ? { chordSymbols: measure.chordSymbols.filter(chord => !discardedTextAnchors.has(chord.beatId)) } : {}),
        beats: events as ILXMBeat[], tuplets: measure.tuplets.filter(g => !removedTupletIds.has(g.id)) };
  const discardedTextCount = numbered ? measure.lyrics.length - nextMeasure.lyrics.length
    : measure.chordSymbols.length - nextMeasure.chordSymbols.length;
  const focusTick = Math.floor(rawFocus / beatTicks) * beatTicks;
  const focusBeat = focusTick >= startTick && focusTick < endTick ? focusTick / beatTicks : startTick / beatTicks;
  const focusEvent = perBeat[focusBeat - startTick / beatTicks]!.after[0]!;
  const focusTemplate = measureBeats?.[focusBeat] ?? chosen as RhythmPatternTemplate;
  return {
    ok: true as const, measure: nextMeasure, scope: { ...scope, measureId: measure.id }, before: relevant, after,
    durations, perBeat, removedMarks, discardedTextCount,
    focus: { measureId: measure.id, tick: focusEvent.tick, endTick: focusEvent.tick + focusTemplate.ticks[0]!, ...(numbered ? { eventId: focusEvent.id } : { beatId: focusEvent.id }) },
  };
}

/** 找出可能受影响的标记，在所有小节合成后统一检查。 */
function getAffectedRhythmMarks(track: ILXMTrack, numbered: boolean, scope: Interval, useEndpointTicks: boolean) {
  const affectedMarks = new Map<string, boolean>();
  const affected = (id: string, endpoints: (Interval | undefined)[]) => {
    const points = endpoints.filter((point): point is Interval => !!point);
    if (!points.length) return;
    const span = { start: Math.min(...points.map(p => p.start)), end: Math.max(...points.map(p => p.end)) };
    if (overlaps(span, scope)) {
      // For a split TAB event, the attack still owns its marks. Its duration may extend beyond the target.
      const crossesScope = useEndpointTicks
        ? points.some(point => point.start < scope.start || point.start >= scope.end)
        : span.start < scope.start || span.end > scope.end;
      affectedMarks.set(id, crossesScope);
    }
  };
  if (numbered && track.numberedMarks.length) {
    const index = buildNumberedIndex(track);
    for (const mark of track.numberedMarks) {
      const points = mark.type === "tie" ? [index.items.get(mark.fromItemId), index.items.get(mark.toItemId)]
        : mark.type === "slur" ? [index.events.get(mark.fromEventId), index.events.get(mark.toEventId)] : [index.events.get(mark.eventId)];
      affected(mark.id, points);
    }
  } else if (!numbered && track.techniques.length) {
    const beatIndex = new Map<string, Interval>();
    const noteIndex = new Map<string, Interval>();
    let offset = 0;
    for (const measure of track.measures) {
      const context = createMeasureRhythmContext(measure);
      for (const beat of measure.beats) {
        const duration = context.getBeatDurationTicks(beat);
        if (!duration.ok) continue;
        const point = { start: offset + beat.tick, end: offset + beat.tick + duration.ticks };
        beatIndex.set(beat.id, point);
        beat.notes.forEach(note => noteIndex.set(note.id, point));
      }
      offset += getMeasureDurationTicks(measure);
    }
    for (const mark of track.techniques) {
      const points = "fromNoteId" in mark ? [noteIndex.get(mark.fromNoteId), ...("toNoteId" in mark ? [noteIndex.get(mark.toNoteId)] : [])]
        : "beatId" in mark ? [beatIndex.get(mark.beatId)] : [beatIndex.get(mark.fromBeatId), beatIndex.get(mark.toBeatId)];
      affected(mark.id, points);
    }
  }
  return affectedMarks;
}

/** 纯规划：所有小节都成功后才返回可提交的候选轨道。 */
export const planRhythmPattern = (document: ILXMDocument, target: RhythmPatternTarget, templateId: string): RhythmPatternPlan => {
  const track = document.score.tracks.find(t => t.id === target.trackId);
  if (!track || !["numbered", "tab"].includes(target.layer))
    return fail("INVALID_RHYTHM_PATTERN_TARGET", "请先在当前简谱或 TAB 谱层选择同轨的位置。");
  const ranges = getRhythmPatternMeasureRanges(track, target);
  const first = ranges[0];
  if (!first) return fail("INVALID_RHYTHM_PATTERN_TARGET", "选区已失效，请重新选择谱面位置。");

  const multiMeasure = ranges.length > 1;
  const numbered = target.layer === "numbered";
  const ids = createDocumentIdFactory(document);
  const createId = () => numbered ? ids.createNumberedEventId() : ids.createBeatId();
  const plans: Extract<ReturnType<typeof planMeasureRhythmPattern> | ReturnType<typeof planMeasureStrumPattern> |
    ReturnType<typeof planBeatStrumPattern>, { ok: true }>[] = [];
  const firstSignature = first.measure.timeSignature;
  const firstTemplates = getRhythmPatternTemplates(firstSignature);
  const beatStrum = beatStrumTemplates.find(item => item.id === templateId);
  const strum = beatStrum ?? strumTemplates.find(item => item.id === templateId);
  const template = strum ?? firstTemplates.find(item => item.id === templateId) ??
    getMeasureRhythmPatternTemplates(firstSignature).find(item => item.id === templateId);
  if (strum && numbered) return fail("INVALID_RHYTHM_PATTERN_TARGET", "请先在六线谱中选择扫弦模板的应用范围。");
  if (beatStrum && multiMeasure) return fail("INVALID_RHYTHM_PATTERN_TARGET", "请在六线谱中选择一拍。");
  if (!strum && !firstTemplates.length) return fail("UNSUPPORTED_TIME_SIGNATURE", `${describeMeasure(first)}不支持节奏型。当前仅支持 4/4、3/4 和 6/8 拍。`);
  if (!template) return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", `当前模板不适用于${describeMeasure(first)}，请重新选择。`);
  const wholeMeasure = "beats" in template;
  const oldStrums = strum ? strumsByBeatId(track) : new Map<string, StrumTechnique>();
  for (const range of ranges) {
    const signature = range.measure.timeSignature;
    if ("strokes" in template) {
      const label = describeMeasure(range);
      const templates = beatStrum ? getBeatStrumRhythmPatternTemplates(signature) : getStrumRhythmPatternTemplates(signature);
      if (!templates.length)
        return fail("UNSUPPORTED_TIME_SIGNATURE", `${label}无法应用扫弦模板，请选择 ${beatStrum ? "4/4 或 3/4" : "4/4"} 拍小节。`);
      if (!isValidMeasureRange(range, multiMeasure))
        return fail("INVALID_RHYTHM_PATTERN_TARGET", `${label}的选区或焦点已失效，请重新选择谱面位置。`);
      const plan = beatStrum ? planBeatStrumPattern(range, beatStrum, ids, oldStrums) : planMeasureStrumPattern(range, template, ids);
      if (!plan.ok) return fail(plan.code, `${label}：${plan.message}`);
      plans.push(plan);
      continue;
    }
    const templates = getRhythmPatternTemplates(signature);
    if (!templates.length) return fail("UNSUPPORTED_TIME_SIGNATURE", `${describeMeasure(range)}不支持节奏型。`);
    if (wholeMeasure && (signature.numerator !== firstSignature.numerator || signature.denominator !== firstSignature.denominator)) {
      return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", `${describeMeasure(range)}拍号不同，整小节模板需要相同拍号。`);
    }
    if (!wholeMeasure && !templates.some(item => item.id === templateId)) {
      return fail("RHYTHM_PATTERN_TEMPLATE_MISMATCH", `当前模板不适用于${describeMeasure(range)}，请重新选择。`);
    }
    const plan = planMeasureRhythmPattern(range, template, templates[0]!.beatTicks, multiMeasure, numbered, createId);
    if (!plan.ok) return multiMeasure ? fail(plan.code, `${describeMeasure(range)}：${plan.message}`) : plan;
    plans.push(plan);
  }

  const scopes = plans.map(plan => plan.scope);
  const firstScope = scopes[0]!, lastScope = scopes.at(-1)!;
  const offset = track.measures.slice(0, first.index).reduce((ticks, measure) => ticks + getMeasureDurationTicks(measure), 0);
  const lastOffset = ranges.slice(0, -1).reduce((ticks, range) => ticks + range.capacity, offset);
  const alreadyApplied = plans.some(plan => "alreadyApplied" in plan && plan.alreadyApplied);
  const affectedMarks = alreadyApplied ? new Map<string, boolean>() : getAffectedRhythmMarks(track, numbered, {
    start: offset + firstScope.startTick, end: lastOffset + lastScope.endTick,
  }, !!beatStrum);
  const nextTrack: ILXMTrack = { ...track, measures: [...track.measures] };
  const removedMarks = new Map<string, RhythmPatternRemovedMark>();
  const techniquesToAdd: ILXMTechnique[] = [];
  const matchedStrumIds = new Set<string>();
  const replacedStrumIds = new Set<string>();
  const strummedBeatIds = new Set<string>();
  const strummedNoteIds = new Set<string>();
  for (const [index, plan] of plans.entries()) {
    nextTrack.measures[first.index + index] = plan.measure;
    for (const mark of plan.removedMarks) removedMarks.set(mark.id, mark);
    if (!("techniques" in plan) || alreadyApplied) continue;
    if ("replacedStrumIds" in plan) for (const id of plan.replacedStrumIds) replacedStrumIds.add(id);
    if ("ties" in plan) techniquesToAdd.push(...plan.ties);
    for (const beat of plan.after) {
      strummedBeatIds.add(beat.id);
      for (const note of beat.notes) strummedNoteIds.add(note.id);
    }
    for (const draft of plan.techniques) {
      const existing = oldStrums.get(draft.beatId);
      if (existing && sameTechniqueDraft(existing, draft)) matchedStrumIds.add(existing.id);
      else techniquesToAdd.push({ ...draft, id: ids.createTechniqueId() });
    }
  }
  const removedConnectionIds = new Set<string>();
  const discardMark = ({ id, type }: { id: string; type: string }) => {
    removedConnectionIds.add(id);
    removedMarks.set(id, { id, type, name: markNames[type] ?? type, crossesScope: affectedMarks.get(id) ?? false });
  };
  if (affectedMarks.size && numbered) {
    const index = buildNumberedIndex(nextTrack);
    // 保留的简谱事件维持相对顺序，范围嵌套关系也随之保持。逐个复核端点及时值。
    for (const mark of track.numberedMarks) {
      if (affectedMarks.has(mark.id) && validateNumberedMarks({ ...nextTrack, numberedMarks: [mark] }, index)) discardMark(mark);
    }
    if (removedConnectionIds.size) nextTrack.numberedMarks = track.numberedMarks.filter(mark => !removedConnectionIds.has(mark.id));
  } else if (affectedMarks.size) {
    // 范围外技巧优先保留。受影响的技巧按文档顺序复核，已失效的技巧不参与互斥判断。
    const kept = [...track.techniques.filter(mark => !affectedMarks.has(mark.id) || matchedStrumIds.has(mark.id)), ...techniquesToAdd];
    const affected = track.techniques.filter(mark => affectedMarks.has(mark.id) && !matchedStrumIds.has(mark.id));
    // 延音线依赖同批次仍然有效的扫弦/琶音，不能按它们的序列化顺序决定是否保留。
    const ordered = [...affected.filter(mark => mark.type !== "traversalTie"), ...affected.filter(mark => mark.type === "traversalTie")];
    for (const mark of ordered) {
      // A connection into a template stroke changes or suppresses its attack.
      const absorbsStroke = ("toNoteId" in mark && strummedNoteIds.has(mark.toNoteId)) ||
        (mark.type === "traversalTie" && strummedBeatIds.has(mark.toBeatId));
      if (!absorbsStroke && validateTechnique({ ...nextTrack, techniques: kept }, mark).ok) kept.push(mark);
      else {
        if (strum && affectedMarks.get(mark.id))
          return fail("RHYTHM_PATTERN_CROSSING_CONTENT", `选区边界有无法保留的${markNames[mark.type] ?? mark.type}，请调整选区。`);
        if (replacedStrumIds.has(mark.id)) removedConnectionIds.add(mark.id);
        else discardMark(mark);
      }
    }
  }
  if (!numbered && (removedConnectionIds.size || techniquesToAdd.length))
    nextTrack.techniques = [...track.techniques.filter(mark => !removedConnectionIds.has(mark.id)), ...techniquesToAdd];
  const changed = !alreadyApplied && !semanticJsonEqual(track, nextTrack);
  if (changed && beatStrum) {
    const followingBeat = firstScope.endTick < first.capacity
      ? first.measure.beats.find(beat => beat.tick === firstScope.endTick)
      : track.measures[first.index + 1]?.beats[0];
    if (followingBeat?.notes.some(note => note.fret === "-")) {
      const beatPlan = plans[0];
      const previous = beatPlan && "ties" in beatPlan ? beatPlan.before.at(-1) : undefined;
      const latest = beatPlan && "ties" in beatPlan ? beatPlan.after.at(-1) : undefined;
      if (!previous?.notes.length || !matchesStrumVoicing(latest, previous.notes))
        return fail("RHYTHM_PATTERN_CROSSING_CONTENT", "下一拍有跨出选区的 TAB 延音，请先调整延音。");
    }
  } else if (changed && strum) {
    const firstBeat = first.measure.beats[0];
    const following = track.measures[first.index + ranges.length];
    if (first.index > 0 && firstBeat?.notes.some(note => note.fret === "-"))
      return fail("RHYTHM_PATTERN_CROSSING_CONTENT", `${describeMeasure(first)}首拍有跨选区的 TAB 延音，请调整选区。`);
    if (following?.beats[0]?.notes.some(note => note.fret === "-"))
      return fail("RHYTHM_PATTERN_CROSSING_CONTENT", `第 ${first.index + ranges.length + 1} 小节首拍有跨选区的 TAB 延音，请调整选区。`);
  }
  const after = plans.flatMap(plan => plan.after);
  // 先比较音乐结果，避免只为新增保护字段创建历史。新构造对象同时被
  // after/perBeat.after/nextMeasure引用，确认真正变化后才标记范围内空拍。
  if (changed && !numbered) {
    for (const event of after) {
      if ("notes" in event && event.kind === "notes" && !event.notes.length)
        event.preserveInputRhythm = true;
    }
  }
  const focus = plans.find(plan => plan.focus.measureId === (target.focusMeasureId ?? target.measureId))!.focus;
  return {
    ok: true, target: { ...target, startTick: firstScope.startTick, endTick: lastScope.endTick }, scope: firstScope, scopes, template,
    before: plans.flatMap(plan => plan.before), after,
    beforeDurationTicks: Object.fromEntries(plans.flatMap(plan => [...plan.durations])),
    perBeat: plans.flatMap(plan => plan.perBeat), removedMarks: [...removedMarks.values()],
    discardedTextCount: plans.reduce((total, plan) => total + plan.discardedTextCount, 0),
    requiresConfirmation: changed && !!strum && !beatStrum,
    // 完整值比较避免散列碰撞；包括原始选区、所有文档内容和 revision。
    confirmationKey: JSON.stringify(["rhythm-pattern-v1", document, target, templateId]),
    track: changed ? nextTrack : track, changed,
    focus: { trackId: track.id, ...focus },
  };
};
