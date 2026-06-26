import { calculateRhythmTicks, getMeasureCapacityTicks } from "../core/rhythm";
import type { Measure, RhythmValue, TimeSignature } from "../core/schema";
import { getBeatTicks } from "./layout-helpers";
import { projectTickToMeasureX } from "./measure-spacing";
import type {
  LaidOutBeat,
  LaidOutBeatEditGridSlot,
  LaidOutEditGridSlot,
  MeasureEditGrid,
  MeasureSpacingSummary,
} from "./layout-types";

interface MeasureCoverageSegment {
  kind: "beat" | "gap";
  startTick: number;
  endTick: number;
  beatId?: string;
}

const buildSingleBeatSlot = (
  measure: Measure,
  beat: LaidOutBeat,
): LaidOutBeatEditGridSlot => ({
  id: `${measure.id}-${beat.id}-slot-0`,
  kind: "beat",
  measureId: measure.id,
  beatId: beat.id,
  coveringBeatId: beat.id,
  tick: beat.tick,
  x: beat.x,
  width: beat.width,
  isBeatStart: true,
});

/**
 * 把真实 beat 时间线补齐为整小节 coverage segment。
 *
 * 这里不会创建任何 placeholder beat，只是把“已有音乐事件覆盖的区间”和
 * “没有任何真实 beat 的空洞区间”显式化。后续 edit grid 和命令层都基于这份
 * coverage 工作，避免继续把 gap 当成“不存在的数据”直接跳过。
 */
const buildMeasureCoverageSegments = (
  measure: Measure,
  timeSignature: TimeSignature,
): MeasureCoverageSegment[] => {
  const capacityTicks = getMeasureCapacityTicks(timeSignature);
  const segments: MeasureCoverageSegment[] = [];
  const sortedBeats = [...measure.beats].sort((left, right) => left.tick - right.tick);
  let cursorTick = 0;

  for (const beat of sortedBeats) {
    const beatStartTick = Math.max(0, Math.min(beat.tick, capacityTicks));
    const beatEndTick = Math.max(
      beatStartTick,
      Math.min(beat.tick + getBeatTicks(beat, measure.tuplets), capacityTicks),
    );

    if (cursorTick < beatStartTick) {
      segments.push({
        kind: "gap",
        startTick: cursorTick,
        endTick: beatStartTick,
      });
    }

    if (beatStartTick < beatEndTick) {
      segments.push({
        kind: "beat",
        beatId: beat.id,
        startTick: beatStartTick,
        endTick: beatEndTick,
      });
      cursorTick = Math.max(cursorTick, beatEndTick);
    }
  }

  if (cursorTick < capacityTicks) {
    segments.push({
      kind: "gap",
      startTick: cursorTick,
      endTick: capacityTicks,
    });
  }

  return segments;
};

/**
 * 按当前编辑时值在整小节 coverage 上生成 slot。
 *
 * 旧实现只会细分 laidOutBeats，因此无法覆盖尾部和中间 gap。新实现统一遍历
 * coverage segment：beat segment 继续保留原有拆分行为，gap segment 则生成
 * 可点击但未落盘的空槽。tuplet 仍然单槽回退，避免这轮引入不稳定的 tick 语义。
 */
export const buildMeasureEditGrid = (
  measure: Measure,
  spacing: MeasureSpacingSummary,
  laidOutBeats: LaidOutBeat[],
  context: {
    measureX: number;
    timeSignature: TimeSignature;
    editingRhythm?: RhythmValue;
  },
): MeasureEditGrid | undefined => {
  if (!context.editingRhythm) return undefined;

  const slotTicksResult = calculateRhythmTicks(context.editingRhythm);
  if (!slotTicksResult.ok) return undefined;
  const slotTicks = slotTicksResult.ticks;
  const beatById = new Map(laidOutBeats.map((beat) => [beat.id, beat] as const));
  const tupletBeatIds = new Set(
    measure.tuplets.flatMap((tuplet) => tuplet.beatIds),
  );
  const slots: LaidOutEditGridSlot[] = [];
  for (const segment of buildMeasureCoverageSegments(measure, context.timeSignature)) {
    const segmentTicks = segment.endTick - segment.startTick;
    if (segmentTicks <= 0) continue;

    // tuplet 这轮仍然保持单槽回退，避免 UI 先暴露出命令层还不稳定的细分能力。
    if (
      segment.kind === "beat" &&
      segment.beatId &&
      tupletBeatIds.has(segment.beatId)
    ) {
      const laidOutBeat = beatById.get(segment.beatId);
      if (laidOutBeat) {
        slots.push(buildSingleBeatSlot(measure, laidOutBeat));
      }
      continue;
    }

    if (segmentTicks % slotTicks !== 0) {
      if (segment.kind === "beat" && segment.beatId) {
        const laidOutBeat = beatById.get(segment.beatId);
        if (laidOutBeat) {
          slots.push(buildSingleBeatSlot(measure, laidOutBeat));
        }
      }
      continue;
    }

    const slotCount = segmentTicks / slotTicks;
    for (let index = 0; index < slotCount; index += 1) {
      const tick = segment.startTick + index * slotTicks;
      // slot 宽度不再直接继承 beat.width，而是由“当前 tick 到下一个 slot tick”
      // 在整小节时间轴上的投影差值决定，这样 gap 和 beat 都能复用同一套几何逻辑。
      const x = projectTickToMeasureX(spacing, measure, {
        measureX: context.measureX,
        timeSignature: context.timeSignature,
        tick,
      });
      const nextX = projectTickToMeasureX(spacing, measure, {
        measureX: context.measureX,
        timeSignature: context.timeSignature,
        tick: tick + slotTicks,
      });

      /**
       * 正常情况下，slot 宽度应当等于相邻两个 slot tick 投影点的差值。
       * 这里只保留 1px 的兜底，用于防御异常数据或舍入误差；前导 gap 的真实宽度
       * 应该由时间轴投影本身给出，而不是靠这里的最小值强行撑开。
       */
      const width = Math.max(1, nextX - x);

      if (segment.kind === "beat" && segment.beatId) {
        slots.push({
          id: `${measure.id}-${segment.beatId}-slot-${index}`,
          kind: "beat",
          measureId: measure.id,
          ...(index === 0 ? { beatId: segment.beatId } : {}),
          coveringBeatId: segment.beatId,
          tick,
          x,
          width,
          isBeatStart: index === 0,
        });
        continue;
      }

      slots.push({
        id: `${measure.id}-gap-${segment.startTick}-${segment.endTick}-slot-${index}`,
        kind: "gap",
        measureId: measure.id,
        tick,
        x,
        width,
        gapStartTick: segment.startTick,
        gapEndTick: segment.endTick,
        isBeatStart: false,
      });
    }
  }

  return { rhythm: context.editingRhythm, slots };
};
