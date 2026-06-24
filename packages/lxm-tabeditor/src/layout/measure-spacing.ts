import type { Beat, Measure } from "../core/schema";
import {
  DURATION_MIN_COLUMN_WIDTH,
  DURATION_VISUAL_WEIGHT,
  MEASURE_IDEAL_WIDTH_PADDING,
  MEASURE_MIN_WIDTH,
  MEASURE_PADDING_X,
} from "./layout-constants";
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
  },
): MeasureSpacingSummary => {
  const summary = summarizeMeasureSpacingWidth(measure);
  const assignedWidth = Math.max(context.assignedWidth, summary.minWidth);
  const availableWidth = Math.max(0, assignedWidth - MEASURE_PADDING_X * 2);
  const columnWidths = distributeColumnWidths(summary.columns, availableWidth);
  const slotsByBeatId: Record<string, BeatSpacingSlot> = {};

  let cursorX = context.x + MEASURE_PADDING_X;

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
