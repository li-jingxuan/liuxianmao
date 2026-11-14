import type { ILXMBeat, ILXMMeasure, ILXMRhythm, ILXMTrack } from "../types";
import { TICKS_PER_QUARTER } from "../constants";
import { BASE_RHYTHM_TICKS, calculateRhythmTicks, createRestRhythmsForTicks, getMeasureCapacityTicks } from "./rhythm";
import { techniqueBeatIds } from "../techniques/content-protection";

/** schema8 的兼容编码；混合拍仍按原有逐弦内容处理。 */
export const isPureTabContinuationBeat = (beat: ILXMBeat): boolean =>
  beat.notes.length > 0 && beat.notes.every((note) => note.fret === "-");

export const tabContinuationRhythm = (measure: ILXMMeasure): ILXMRhythm | undefined => {
  const ticks = TICKS_PER_QUARTER * 4 / measure.timeSignature.denominator;
  const base = (Object.entries(BASE_RHYTHM_TICKS) as [ILXMRhythm["base"], number][])
    .find(([, duration]) => duration === ticks)?.[0];
  return base ? { base, dots: 0 } : undefined;
};

/** 包括 P.M./Let Ring 内部空拍，而不仅是技巧端点。 */
const protectedBeats = (track: ILXMTrack): Set<string> => {
  const ids = new Set(techniqueBeatIds(track));
  const beats = track.measures.flatMap((measure) => measure.beats);
  for (const technique of track.techniques) {
    if (!("fromBeatId" in technique)) continue;
    const from = beats.findIndex((beat) => beat.id === technique.fromBeatId);
    const to = beats.findIndex((beat) => beat.id === technique.toBeatId);
    if (from >= 0 && to >= from)
      for (const beat of beats.slice(from, to + 1)) ids.add(beat.id);
  }
  return ids;
};

/** 固定时间窗替换。仅消耗无保护空位，后续起点与时值完全不变。 */
export const planTabContinuation = (
  track: ILXMTrack,
  measure: ILXMMeasure,
  beatId: string,
  createBeatId: () => string,
  createNoteId: () => string,
): ILXMMeasure | undefined => {
  const index = measure.beats.findIndex((beat) => beat.id === beatId);
  const target = measure.beats[index];
  const rhythm = tabContinuationRhythm(measure);
  if (!target || !rhythm) return;
  const duration = calculateRhythmTicks(rhythm);
  if (!duration.ok) return;
  const end = target.tick + duration.ticks;
  if (end > getMeasureCapacityTicks(measure.timeSignature)) return;
  const protectedIds = protectedBeats(track);
  const consumed: ILXMBeat[] = [];
  let coveredEnd = target.tick;
  for (const candidate of measure.beats.slice(index)) {
    if (coveredEnd >= end) break;
    if (candidate.tick !== coveredEnd || measure.tuplets.some((group) => group.beatIds.includes(candidate.id))) return;
    if (candidate !== target && (candidate.notes.length || protectedIds.has(candidate.id) ||
      measure.chordSymbols.some((chord) => chord.beatId === candidate.id))) return;
    const ticks = calculateRhythmTicks(candidate.rhythm);
    if (!ticks.ok) return;
    consumed.push(candidate);
    coveredEnd += ticks.ticks;
  }
  if (coveredEnd < end) return;
  // 缩短目标会分割受保护的原拍，无法安全保留其区间语义。
  if (coveredEnd > end && protectedIds.has(consumed.at(-1)!.id)) return;
  const remainder = createRestRhythmsForTicks(coveredEnd - end);
  if (!remainder.ok) return;
  if (consumed.length === 1 && isPureTabContinuationBeat(target) &&
    target.rhythm.base === rhythm.base && target.rhythm.dots === 0) return measure;
  let tick = end;
  const tail: ILXMBeat[] = remainder.rhythms.map((restRhythm) => {
    const beat: ILXMBeat = { id: createBeatId(), tick, rhythm: restRhythm, kind: "rest", notes: [] };
    const ticks = calculateRhythmTicks(restRhythm);
    if (ticks.ok) tick += ticks.ticks;
    return beat;
  });
  const continuation: ILXMBeat = {
    ...target, rhythm, kind: "notes",
    notes: [{ id: createNoteId(), string: 3, fret: "-" }],
  };
  return { ...measure, beats: [...measure.beats.slice(0, index), continuation, ...tail, ...measure.beats.slice(index + consumed.length)] };
};
