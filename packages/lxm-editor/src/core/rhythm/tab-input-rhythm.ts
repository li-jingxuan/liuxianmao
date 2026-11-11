import { techniqueBeatIds } from "../techniques/content-protection";
import { calculateRhythmTicks, createRestRhythmsForTicks } from "./rhythm";
import type { ILXMBeat, ILXMMeasure, ILXMRhythm, ILXMTrack } from "../types";

/** 先完整规划空位替换，显示默认值与实际录入共用同一保护边界。 */
const planTabInputRhythm = (track: ILXMTrack, measure: ILXMMeasure, beatId: string) => {
  const index = measure.beats.findIndex((beat) => beat.id === beatId);
  const beat = measure.beats[index];
  if (!beat) return;
  const event = measure.numberedVoice.events.find((item) => item.tick === beat.tick && item.kind !== "gap");
  if (!event || measure.numberedVoice.tuplets.some((group) => group.eventIds.includes(event.id))) return;
  const duration = calculateRhythmTicks(event.rhythm);
  if (!duration.ok) return;
  const endTick = beat.tick + duration.ticks;
  const protectedIds = new Set(techniqueBeatIds(track));
  // 区间技巧的内部空拍也有演奏语义，不能仅保护两个端点。
  const ordered = track.measures.flatMap((item) => item.beats);
  for (const technique of track.techniques) {
    if (!("fromBeatId" in technique)) continue;
    const from = ordered.findIndex((item) => item.id === technique.fromBeatId);
    const to = ordered.findIndex((item) => item.id === technique.toBeatId);
    if (from >= 0 && to >= from)
      for (const item of ordered.slice(from, to + 1)) protectedIds.add(item.id);
  }
  const consumed: ILXMBeat[] = [];
  let coveredEnd = beat.tick;
  for (const candidate of measure.beats.slice(index)) {
    if (coveredEnd >= endTick) break;
    if (candidate.tick !== coveredEnd || candidate.kind !== "notes" || candidate.notes.length ||
      protectedIds.has(candidate.id) || measure.chordSymbols.some((chord) => chord.beatId === candidate.id) ||
      measure.tuplets.some((group) => group.beatIds.includes(candidate.id))) return;
    const ticks = calculateRhythmTicks(candidate.rhythm);
    if (!ticks.ok) return;
    consumed.push(candidate);
    coveredEnd += ticks.ticks;
  }
  if (coveredEnd < endTick) return;
  const remainder = createRestRhythmsForTicks(coveredEnd - endTick);
  if (!remainder.ok) return;
  return { beat, rhythm: event.rhythm, consumed, endTick, remainder: remainder.rhythms };
};

/** 仅空白普通 TAB 拍可继承同起点简谱节奏；保护区和无可靠映射的连音返回 undefined。 */
export const tabInputRhythmFromNumbered = (
  track: ILXMTrack,
  measure: ILXMMeasure,
  beatId: string,
): ILXMRhythm | undefined => planTabInputRhythm(track, measure, beatId)?.rhythm;

/** 在 note 命令内部准备空位，不移动后续 tick，也不产生独立历史。 */
export const prepareTabInputRhythm = (
  track: ILXMTrack,
  measure: ILXMMeasure,
  beatId: string,
  createBeatId: () => string,
): ILXMMeasure => {
  const plan = planTabInputRhythm(track, measure, beatId);
  if (!plan || (plan.consumed.length === 1 && plan.beat.rhythm.base === plan.rhythm.base && plan.beat.rhythm.dots === plan.rhythm.dots)) return measure;
  const consumedIds = new Set(plan.consumed.map((beat) => beat.id));
  let tick = plan.endTick;
  const remainder: ILXMBeat[] = plan.remainder.map((rhythm) => {
    const beat: ILXMBeat = { id: createBeatId(), tick, rhythm, kind: "notes", notes: [] };
    const duration = calculateRhythmTicks(rhythm);
    if (duration.ok) tick += duration.ticks;
    return beat;
  });
  return {
    ...measure,
    beats: measure.beats.flatMap((beat) => beat.id === beatId
      ? [{ ...beat, rhythm: { ...plan.rhythm } }, ...remainder]
      : consumedIds.has(beat.id) ? [] : [beat]),
  };
};
