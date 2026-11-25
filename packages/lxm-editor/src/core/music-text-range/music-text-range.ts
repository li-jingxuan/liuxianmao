import { planLyricPositions } from "../lyrics/lyric-positions";
import { parseLyricSequence } from "../lyrics/lyric-sequence";
import { editMeasureMusicText } from "../music-text/music-text-commands";
import { parseNumberedSequence, type NumberedSequenceItem } from "../numbered/numbered-notation";
import { numberedSequenceContent, planNumberedSequenceSlots } from "../numbered/numbered-sequence-overwrite";
import { createNumberedTrackRhythmContext } from "../numbered/numbered-rhythm";
import type { ILXMIdFactory } from "../id-factory";
import type { ILXMDocument, ILXMLyricVerse, ILXMRhythm, ILXMTrack } from "../types";

export interface MusicTextRangePosition {
  measureId: string;
  eventId?: string;
  tick?: number;
  endTick?: number;
}

/** Both endpoints are inclusive. Event identity wins over a time-window reference. */
export interface MusicTextRange {
  trackId: string;
  kind: "numbered" | "lyric";
  verse?: ILXMLyricVerse;
  anchor: MusicTextRangePosition;
  focus: MusicTextRangePosition;
}

export interface MusicTextRangeSlot extends MusicTextRangePosition {
  tick: number;
  endTick: number;
  rhythm?: ILXMRhythm;
}

type Failure = { ok: false; message: string };
type ResolvedRange = { ok: true; range: MusicTextRange; slots: MusicTextRangeSlot[] };

/** The navigation order is measure-array order, then tick; chords remain one slot. */
export const collectMusicTextRangeSlots = (
  document: ILXMDocument,
  range: Pick<MusicTextRange, "trackId" | "kind" | "verse">,
): MusicTextRangeSlot[] => {
  if (range.kind !== "numbered" && range.kind !== "lyric") return [];
  if (range.kind === "lyric" && ![1, 2, 3, 4].includes(range.verse!)) return [];
  const track = document.score.tracks.find(track => track.id === range.trackId);
  if (!track) return [];
  const context = createNumberedTrackRhythmContext(track);
  return track.measures.flatMap(original => {
    const measure = {
      ...original,
      numberedVoice: { ...original.numberedVoice, events: [...original.numberedVoice.events].sort((a, b) => a.tick - b.tick) },
    };
    return range.kind === "lyric"
      ? planLyricPositions(measure, context).map(position => ({ measureId: measure.id, ...position }))
      : planNumberedSequenceSlots(measure, context).map(slot => ({
          measureId: measure.id,
          ...(slot.eventId ? { eventId: slot.eventId } : {}),
          tick: slot.startTick,
          endTick: slot.endTick,
          ...(slot.rhythm ? { rhythm: slot.rhythm } : {}),
        }));
  });
};

/** 跨线连音转换会迁移起音小节，显式事件按轨道内的稳定 ID 解析；时间窗仍绑定原小节。 */
export const resolveMusicTextRange = (
  document: ILXMDocument,
  range: MusicTextRange,
): ResolvedRange | Failure => {
  const all = collectMusicTextRangeSlots(document, range);
  const find = (position: MusicTextRangePosition) => all.findIndex(slot => position.eventId
    ? slot.eventId === position.eventId
    : slot.measureId === position.measureId && slot.tick === position.tick && slot.endTick === position.endTick);
  const anchor = find(range.anchor), focus = find(range.focus);
  if (anchor < 0 || focus < 0)
    return { ok: false, message: "音乐文本选区已失效，请重新选择同轨道、同歌词段的位置。" };
  return { ok: true, range, slots: all.slice(Math.min(anchor, focus), Math.max(anchor, focus) + 1) };
};

/** Empty slots use the same underscore notation as sequence input. */
export const readMusicTextRange = (
  document: ILXMDocument,
  range: MusicTextRange,
): (ResolvedRange & { text: string }) | Failure => {
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return resolved;
  const track = document.score.tracks.find(track => track.id === range.trackId)!;
  const text = resolved.slots.map(slot => {
    const measure = track.measures.find(measure => measure.id === slot.measureId)!;
    if (range.kind === "lyric")
      return measure.lyrics.find(lyric => lyric.eventId === slot.eventId && lyric.verse === range.verse)?.text ?? "_";
    return measure.numberedVoice.events.find(event => event.id === slot.eventId)?.items.map(item => item.token).join("+") || "_";
  }).join(" ");
  return { ...resolved, text };
};

const parseNumberedRange = (text: string): { ok: true; items: NumberedSequenceItem[] } | Failure => {
  if ([...text].length > 16384) return { ok: false, message: "简谱输入最多 16384 个字符。" };
  if (/^[ \u3000]*$/u.test(text)) return { ok: true, items: [] };
  // Sequence insertion requires at least one note; a bounded replacement also allows only skips.
  if (/^[_ \u3000]+$/u.test(text) && [...text].length <= 16384) {
    const parts = text.split(/[ \u3000]+/u).filter(Boolean);
    if (parts.length <= 256 && parts.every(part => part === "_"))
      return { ok: true, items: parts.map(() => ({ kind: "skip" })) };
  }
  return parseNumberedSequence(text);
};

/** Build one candidate track. The command dispatcher alone commits revision/history. */
export const replaceMusicTextRange = (
  document: ILXMDocument,
  range: MusicTextRange,
  text: string,
  factory: ILXMIdFactory,
): { ok: true; changed: boolean; track: ILXMTrack } | Failure => {
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return resolved;
  if (typeof text !== "string") return { ok: false, message: "范围内容必须是文本。" };
  const track = document.score.tracks.find(track => track.id === range.trackId)!;
  const parsed = range.kind === "numbered" ? parseNumberedRange(text) : parseLyricSequence(text);
  if (!parsed.ok) return parsed;
  if (parsed.items.length > resolved.slots.length)
    return { ok: false, message: "输入数量超过所选范围，整批未应用。" };
  const measures = new Map(track.measures.map(measure => [measure.id, measure]));
  const context = createNumberedTrackRhythmContext(track);
  let changed = false;
  for (const [index, slot] of resolved.slots.entries()) {
    let measure = measures.get(slot.measureId)!;
    const item = parsed.items[index];
    if (range.kind === "lyric") {
      const result = editMeasureMusicText(measure, {
        type: "lyric.set" as import("../commands/commands").LXMScoreCommandEnum.SetLyric,
        trackId: range.trackId,
        ...slot,
        verse: range.verse!,
        text: item?.kind === "set" && "text" in item ? item.text : "",
      }, factory, context);
      if (!result.ok) return result;
      changed ||= result.changed;
      measures.set(measure.id, result.measure);
      continue;
    }
    if (item?.kind === "skip") continue;
    const previous = measure.numberedVoice.events.find(event => event.id === slot.eventId);
    const tokens = item?.kind === "set" && "tokens" in item ? item.tokens : [];
    if ((!previous && !tokens.length) || (previous && JSON.stringify(previous.items.map(item => item.token)) === JSON.stringify(tokens))) continue;
    if (tokens[0] === "-" && previous && context.tupletByEventId.get(previous.id)?.crossBar)
      return { ok: false, message: "跨小节简谱连音成员不能录入固定时值的延音。" };
    if ((tokens[0] === "0" || tokens[0] === "-") && measure.lyrics.some(lyric => lyric.eventId === previous?.id))
      return { ok: false, message: "休止或延音无法保留该位置的歌词锚点，整批未应用。" };
    if (!slot.rhythm) return { ok: false, message: "选区包含无法保存时值的时间窗，整批未应用。" };
    const event = {
      ...previous,
      ...numberedSequenceContent(previous, tokens, () => factory.createNumberedItemId()),
      id: previous?.id ?? factory.createNumberedEventId(),
      tick: slot.tick,
      rhythm: previous?.rhythm ?? { ...slot.rhythm },
    };
    measure = {
      ...measure,
      numberedVoice: {
        ...measure.numberedVoice,
        events: [...measure.numberedVoice.events.filter(other => other.id !== previous?.id), event].sort((a, b) => a.tick - b.tick),
      },
    };
    measures.set(measure.id, measure);
    changed = true;
  }
  return { ok: true, changed, track: changed ? { ...track, measures: track.measures.map(measure => measures.get(measure.id)!) } : track };
};
