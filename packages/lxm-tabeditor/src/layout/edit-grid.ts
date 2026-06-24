import { calculateRhythmTicks } from "../core/rhythm";
import type { Measure, RhythmValue } from "../core/schema";
import type { LaidOutBeat, MeasureEditGrid } from "./layout-types";

const buildSingleSlot = (
  measure: Measure,
  beat: LaidOutBeat,
): MeasureEditGrid["slots"][number] => ({
  id: `${measure.id}-${beat.id}-slot-0`,
  measureId: measure.id,
  beatId: beat.id,
  coveringBeatId: beat.id,
  tick: beat.tick,
  x: beat.x,
  width: beat.width,
  isBeatStart: true,
});

/**
 * 按当前编辑时值在真实 beat 的视觉宽度内部派生可点击 slot。
 *
 * 这里刻意不修改 measure.beats：占位格只是编辑态几何索引。普通 beat 如果能被
 * editingRhythm 整除，就按 tick 比例把同一个视觉宽度拆成多个 slot；否则回退成
 * 单槽，避免 layout 层伪造无法落盘的音乐事件。
 *
 * 连音组第一轮也采用单槽回退。tuplet 的 tick 语义需要结合 actual/normal 比例，
 * 如果在这里强行细分，会让 UI 看起来可写入但命令层无法稳定 materialize。
 */
export const buildMeasureEditGrid = (
  measure: Measure,
  laidOutBeats: LaidOutBeat[],
  editingRhythm: RhythmValue | undefined,
): MeasureEditGrid | undefined => {
  if (!editingRhythm) return undefined;

  const slotTicksResult = calculateRhythmTicks(editingRhythm);
  if (!slotTicksResult.ok) return undefined;

  const tupletBeatIds = new Set(
    measure.tuplets.flatMap((tuplet) => tuplet.beatIds),
  );
  const slots = laidOutBeats.flatMap((beat) => {
    const beatTicksResult = calculateRhythmTicks(beat.rhythm);
    if (!beatTicksResult.ok) return [];
    if (tupletBeatIds.has(beat.id)) return [buildSingleSlot(measure, beat)];

    const beatTicks = beatTicksResult.ticks;
    if (beatTicks % slotTicksResult.ticks !== 0) {
      return [buildSingleSlot(measure, beat)];
    }

    const slotCount = beatTicks / slotTicksResult.ticks;
    return Array.from({ length: slotCount }, (_, index) => ({
      id: `${measure.id}-${beat.id}-slot-${index}`,
      measureId: measure.id,
      ...(index === 0 ? { beatId: beat.id } : {}),
      coveringBeatId: beat.id,
      tick: beat.tick + index * slotTicksResult.ticks,
      x: beat.x + (beat.width / slotCount) * index,
      width: beat.width / slotCount,
      isBeatStart: index === 0,
    }));
  });

  return { rhythm: editingRhythm, slots };
};
