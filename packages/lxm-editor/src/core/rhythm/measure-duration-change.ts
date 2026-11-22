import { collectMusicTextBeatIds } from "../music-text/music-text";
import { numberedRhythmForTicks } from "../numbered/numbered-input-ranges";
import type { ILXMBeat, ILXMMeasure } from "../types";
import { createBeatAlignedRestBeats } from "./rest-beats";
import { getMeasureCapacityTicks } from "./rhythm";
import { createMeasureRhythmContext } from "./tuplet";

export type MeasureDurationChangeResult =
  | { ok: true; measure: ILXMMeasure }
  | { ok: false; code: "INVALID_MEASURE_DURATION" | "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE" | "RHYTHM_NOT_REPRESENTABLE" };

/** 仅裁剪边界外的空白，并检查整个尾部，避免其间的空槽遮住后面的真实内容。 */
export const changeMeasureDuration = (
  measure: ILXMMeasure,
  durationTicks: number,
  createBeatId: () => string,
  protectedBeatIds: ReadonlySet<string> = new Set(),
): MeasureDurationChangeResult => {
  const nominal = getMeasureCapacityTicks(measure.timeSignature);
  if (!Number.isInteger(durationTicks) || durationTicks <= 0 || durationTicks > nominal)
    return { ok: false, code: "INVALID_MEASURE_DURATION" };

  const context = createMeasureRhythmContext(measure);
  const textAnchors = collectMusicTextBeatIds(measure);
  const beats: ILXMBeat[] = [];
  let keptEnd = 0;
  for (const beat of measure.beats) {
    const duration = context.getBeatDurationTicks(beat);
    if (!duration.ok) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
    const end = beat.tick + duration.ticks;
    if (end <= durationTicks) {
      beats.push(beat);
      keptEnd = end;
      continue;
    }

    // 旧谱没有记录休止的来源，保留它的原意。自动休止一旦带有标记也属于内容。
    if (beat.notes.length || beat.preserveInputRhythm || (beat.kind === "rest" && !beat.capacityRest) ||
        context.tupletByBeatId.has(beat.id) || protectedBeatIds.has(beat.id) || textAnchors.has(beat.id))
      return { ok: false, code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE" };
    if (beat.tick >= durationTicks) continue;

    // 边界切入空槽时保留槽的 ID。单个普通或附点时值不足以拼写时，分解余量。
    const remaining = durationTicks - beat.tick;
    const rhythm = numberedRhythmForTicks(remaining);
    if (rhythm) beats.push({ ...beat, rhythm: { ...rhythm } });
    else {
      const pieces = createBeatAlignedRestBeats(beat.tick, remaining, measure.timeSignature, createBeatId);
      if (!pieces) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
      pieces.forEach((piece, index) => beats.push({ ...beat, id: index ? piece.id : beat.id, tick: piece.tick, rhythm: piece.rhythm }));
    }
    keptEnd = durationTicks;
  }

  // 扩容只补尾部，不移动原拍点。恢复满拍后省略覆盖值，后续改拍号仍按原规则继承。
  const padding = createBeatAlignedRestBeats(keptEnd, durationTicks - keptEnd, measure.timeSignature, createBeatId);
  if (!padding) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };
  const resized = { ...measure, beats: beats.concat(padding) };
  if (durationTicks === nominal) delete resized.actualDurationTicks;
  else resized.actualDurationTicks = durationTicks;
  return { ok: true, measure: resized };
};
