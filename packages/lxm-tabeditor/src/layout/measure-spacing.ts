import { getMeasureCapacityTicks } from "../core/rhythm";
import type { Beat, Measure, TimeSignature } from "../core/schema";
import {
  DURATION_MIN_COLUMN_WIDTH,
  DURATION_VISUAL_WEIGHT,
  MEASURE_IDEAL_WIDTH_PADDING,
  MEASURE_MIN_WIDTH,
  MEASURE_PADDING_X,
} from "./layout-constants";
import {
  getBeatTicks,
  getMeasureInnerLeftX,
  getMeasureInnerRightX,
} from "./layout-helpers";
import type {
  BeatSpacingSlot,
  MeasureSpacingSummary,
  RhythmicColumn,
} from "./layout-types";

const getBeatDurationWeight = (beat: Beat): number =>
  DURATION_VISUAL_WEIGHT[beat.rhythm.base];

const getBeatMinColumnWidth = (beat: Beat): number =>
  DURATION_MIN_COLUMN_WIDTH[beat.rhythm.base];

/**
 * 将小节内 beats 聚合为节奏列。
 *
 * 目前一个 tick 通常只有一个 beat；仍然按 tick 聚合，是为了让后续歌词、
 * 简谱、和弦等内容都能挂到同一列上，统一反向影响列宽。
 */
export const buildRhythmicColumns = (measure: Measure): RhythmicColumn[] => {
  const beatsByTick = new Map<number, Beat[]>();

  for (const beat of measure.beats) {
    const beats = beatsByTick.get(beat.tick) ?? [];
    beats.push(beat);
    beatsByTick.set(beat.tick, beats);
  }

  return [...beatsByTick.entries()]
    .sort(([leftTick], [rightTick]) => leftTick - rightTick)
    .map(([tick, beats]) => {
      const durationWeight = Math.max(...beats.map(getBeatDurationWeight));
      const minWidth = Math.max(...beats.map(getBeatMinColumnWidth));

      return {
        tick,
        beatIds: beats.map((beat) => beat.id),
        durationWeight,
        minWidth,
        idealWidth: minWidth * durationWeight,
      };
    });
};

const distributeColumnWidths = (
  columns: RhythmicColumn[],
  availableWidth: number,
): number[] => {
  if (columns.length === 0) return [];

  const totalMinWidth = columns.reduce(
    (total, column) => total + column.minWidth,
    0,
  );
  const totalIdealWidth = columns.reduce(
    (total, column) => total + column.idealWidth,
    0,
  );

  if (availableWidth <= totalMinWidth) {
    const scale = totalMinWidth > 0 ? availableWidth / totalMinWidth : 1;
    return columns.map((column) => column.minWidth * scale);
  }

  if (totalIdealWidth <= availableWidth) {
    const extraWidth = availableWidth - totalIdealWidth;
    const extraPerColumn = extraWidth / columns.length;
    return columns.map((column) => column.idealWidth + extraPerColumn);
  }

  /**
   * 可用宽度介于最小宽度和理想宽度之间时，只压缩“理想宽度超出最小宽度”的部分。
   * 这样三十二分音符等短时值仍能守住最低可读空间。
   */
  const compressibleWidth = totalIdealWidth - totalMinWidth;
  const targetCompression = totalIdealWidth - availableWidth;

  return columns.map((column) => {
    const columnCompression =
      compressibleWidth > 0
        ? ((column.idealWidth - column.minWidth) / compressibleWidth) *
          targetCompression
        : 0;

    return column.idealWidth - columnCompression;
  });
};

export const summarizeMeasureSpacingWidth = (
  measure: Measure,
): Pick<MeasureSpacingSummary, "measureId" | "minWidth" | "idealWidth" | "columns"> => {
  const columns = buildRhythmicColumns(measure);
  const minWidth = Math.max(
    MEASURE_MIN_WIDTH,
    columns.reduce((total, column) => total + column.minWidth, 0) +
      MEASURE_PADDING_X * 2,
  );
  const idealWidth = Math.max(
    minWidth,
    columns.reduce((total, column) => total + column.idealWidth, 0) +
      MEASURE_IDEAL_WIDTH_PADDING,
  );

  return {
    measureId: measure.id,
    minWidth,
    idealWidth,
    columns,
  };
};

/**
 * 计算小节内部所有 beat 的最终 x/width。
 *
 * `assignedWidth` 由 system 层决定；本函数只负责在该宽度内分配节奏列，
 * 不关心一行放几个小节，也不修改任何领域 tick。
 */
export const layoutMeasureSpacing = (
  measure: Measure,
  context: {
    x: number;
    assignedWidth: number;
    timeSignature: TimeSignature;
  },
): MeasureSpacingSummary => {
  const summary = summarizeMeasureSpacingWidth(measure);
  const assignedWidth = Math.max(context.assignedWidth, summary.minWidth);
  const availableWidth = Math.max(0, assignedWidth - MEASURE_PADDING_X * 2);
  const capacityTicks = getMeasureCapacityTicks(context.timeSignature);
  const firstColumnTick = summary.columns[0]?.tick ?? 0;
  /**
   * 真实 beat 列宽仍由原有节奏列分配逻辑负责，但如果首个 beat 不是从 tick=0 开始，
   * 小节前导静默区也必须占有水平空间；否则 edit-grid 会把前导 gap 压扁成 1px。
   *
   * 这里按“前导 gap 占整小节容量的 tick 比例”先预留一段宽度，再把剩余宽度分配给
   * 真实 beat 列。这样不会伪造 placeholder beat，也能保证首个真实 beat 的 x
   * 晚于小节时间轴起点。
   */
  const leadingGapWidth =
    capacityTicks > 0 ? (availableWidth * firstColumnTick) / capacityTicks : 0;
  const columnWidths = distributeColumnWidths(
    summary.columns,
    Math.max(0, availableWidth - leadingGapWidth),
  );
  const slotsByBeatId: Record<string, BeatSpacingSlot> = {};

  let cursorX = context.x + MEASURE_PADDING_X + leadingGapWidth;

  summary.columns.forEach((column, columnIndex) => {
    const width = columnWidths[columnIndex] ?? 0;

    for (const beatId of column.beatIds) {
      slotsByBeatId[beatId] = {
        beatId,
        tick: column.tick,
        x: cursorX,
        width,
        columnIndex,
      };
    }

    cursorX += width;
  });

  return {
    ...summary,
    assignedWidth,
    slotsByBeatId,
  };
};

export const getBeatSpacingSlot = (
  spacing: MeasureSpacingSummary,
  beat: Beat,
): BeatSpacingSlot => {
  const slot = spacing.slotsByBeatId[beat.id];
  if (slot) return slot;

  /**
   * fallback 只用于异常数据，避免 layout 因为某个 beat 缺少 slot 而崩溃。
   * 正常路径下所有 beat 都应该由 buildRhythmicColumns 覆盖。
   */
  return {
    beatId: beat.id,
    tick: beat.tick,
    x: spacing.assignedWidth,
    width: 0,
    columnIndex: -1,
  };
};

/**
 * 把小节内任意 tick 投影到 SVG x 坐标。
 *
 * 已有 beat 内部继续沿用 beat 自己的视觉宽度按比例插值；gap 区域则在相邻 beat
 * 边界之间做线性插值。这样可以在不伪造 placeholder beat 的前提下，为中间空洞和
 * 尾部空白生成稳定的可点击几何。
 */
export const projectTickToMeasureX = (
  spacing: MeasureSpacingSummary,
  measure: Measure,
  context: {
    measureX: number;
    timeSignature: TimeSignature;
    tick: number;
  },
): number => {
  const capacityTicks = getMeasureCapacityTicks(context.timeSignature);
  const clampedTick = Math.max(0, Math.min(context.tick, capacityTicks));
  const leftX = getMeasureInnerLeftX(spacing, context.measureX);
  const rightX = getMeasureInnerRightX(spacing, context.measureX);
  const sortedBeats = [...measure.beats].sort((left, right) => left.tick - right.tick);
  const timelineAnchors = [
    { tick: 0, x: leftX },
    ...sortedBeats.flatMap((beat, index) => {
      const slot = spacing.slotsByBeatId[beat.id];
      if (!slot) return [];

      const beatTicks = getBeatTicks(beat, measure.tuplets);
      const nextBeat = sortedBeats[index + 1];
      const nextSlot = nextBeat ? spacing.slotsByBeatId[nextBeat.id] : undefined;
      const nextBoundaryTick = nextBeat?.tick ?? capacityTicks;
      const nextBoundaryX = nextSlot?.x ?? rightX;
      const beatEndTick = Math.min(beat.tick + beatTicks, capacityTicks);

      /**
       * start anchor 始终对齐真实 beat 列起点。
       * 如果 beat 自身时值在“下一个真实 beat 起点”之前就结束，说明后面存在 gap；
       * 这里再补一个 beatEnd anchor，把真实 beat 与后续 gap 的水平空间拆开。
       */
      const anchors = [{ tick: beat.tick, x: slot.x }];
      if (beatEndTick > beat.tick && beatEndTick < nextBoundaryTick) {
        const ratio =
          nextBoundaryTick === beat.tick
            ? 0
            : (beatEndTick - beat.tick) / (nextBoundaryTick - beat.tick);
        anchors.push({
          tick: beatEndTick,
          x: slot.x + (nextBoundaryX - slot.x) * ratio,
        });
      }
      return anchors;
    }),
    { tick: capacityTicks, x: rightX },
  ].sort((left, right) => left.tick - right.tick);

  for (let index = 0; index < timelineAnchors.length - 1; index += 1) {
    const currentAnchor = timelineAnchors[index]!;
    const nextAnchor = timelineAnchors[index + 1]!;
    if (clampedTick < currentAnchor.tick || clampedTick > nextAnchor.tick) {
      continue;
    }

    const rangeTicks = nextAnchor.tick - currentAnchor.tick;
    const ratio =
      rangeTicks === 0
        ? 0
        : (clampedTick - currentAnchor.tick) / rangeTicks;
    return currentAnchor.x + (nextAnchor.x - currentAnchor.x) * ratio;
  }

  return rightX;
};
