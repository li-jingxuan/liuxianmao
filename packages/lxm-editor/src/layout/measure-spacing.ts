import { calculateRhythmTicks } from "../core/rhythm";
import type { ILXMBeat, ILXMMeasure } from "../core/types";
import {
  LXM_DURATION_MIN_COLUMN_WIDTH,
  LXM_DURATION_VISUAL_WEIGHT,
  LXM_MEASURE_MIN_WIDTH,
  LXM_MEASURE_PADDING_X,
} from "./layout-constants";
import type {
  ILXMBeatLayout,
  ILXMRhythmicColumn,
  // ILXMColumnWidthContributors,
} from "./layout-types";

interface ILXMMeasureSpacingSummary {
  // 小节 ID
  measureId: string;
  // 小节最小宽度
  minWidth: number;
  // 小节理想宽度
  idealWidth: number;
  // 当前小节的节奏列信息
  columns: ILXMRhythmicColumn[];

  // 小节已分配宽度
  assignedWidth: number;
  slotsByBeatId: Record<string, ILXMBeatLayout>;
}
type ILXMSummarizeMeasureSpacingWidth = Omit<ILXMMeasureSpacingSummary, "assignedWidth" | "slotsByBeatId">;

/** 计算当前拍的节奏 tick 数量 */
const getBeatRhythmTicks = (beat: ILXMBeat): number => {
  const result = calculateRhythmTicks(beat.rhythm);

  if (!result.ok) {
    throw new Error(`无法把 ${beat.rhythm} 切成合法节奏片段`);
  }

  return result.ticks;
};

/** 构建节奏列；同一 tick 的 TAB、歌词、简谱未来会共享这一列。 */
export const buildRhythmicColumns = (measure: ILXMMeasure): ILXMRhythmicColumn[] => {
  // 当前只需要考虑 notes 类型的节拍
  // 数据结构中暂时不考虑相同 tick 存在多个 beat（节拍）的情况：多轨和多声部才可能出现这种情况
  return measure.beats
    .sort((left, right) => left.tick - right.tick)
    .map((beat) => {
      const rhythmTicks = getBeatRhythmTicks(beat);
      // 当前节拍的时值权重
      const durationWeight = LXM_DURATION_VISUAL_WEIGHT[beat.rhythm.base];
      // 当前节拍的最小宽度限制
      const minWidth = LXM_DURATION_MIN_COLUMN_WIDTH[beat.rhythm.base];

      return {
        tick: beat.tick,
        beatIds: [beat.id],
        rhythmTicks,
        durationWeight,
        minWidth,
        // 理想宽度 = Max(最小宽度限制, 最小宽度限制 * 时值权重)
        // thirtySecond 三十二分音符（durationWeight = 0.72）会使用 minWidth 作为理想宽度
        idealWidth: Math.max(minWidth, minWidth * durationWeight),
      };
    });
};

export const summarizeMeasureSpacingWidth = (measure: ILXMMeasure): ILXMSummarizeMeasureSpacingWidth => {
  // 计算每个 beat 节拍列信息
  const columns = buildRhythmicColumns(measure)
  // 小节内左右边距
  const measurePaddingX = LXM_MEASURE_PADDING_X * 2;
  // 当前小节内容最小宽度
  const minWidth = columns.reduce(
    (total, column) => total + column.minWidth,
    measurePaddingX,
  );

  // 当前小节内容理想宽度
  const idealWidth = columns.reduce(
    (total, column) => total + column.idealWidth,
    measurePaddingX,
  );

  return {
    measureId: measure.id,
    minWidth,
    idealWidth,
    columns,
  };
};

/** 
 * 将节奏列转换成 beat slot，assignedWidth 本轮默认取小节 idealWidth。
*/
export const layoutMeasureSpacing = (
  measure: ILXMMeasure,
  context: {
    x: number;
    // TODO 如果这个小节已经分配了宽度，目前版本这个参数没有意义
    assignedWidth?: number;
  },
): ILXMMeasureSpacingSummary => {
  // 小节 Column Width 摘要信息
  const summary = summarizeMeasureSpacingWidth(measure)

  const assignedWidth = Math.max(
    context.assignedWidth ?? summary.idealWidth,
    summary.minWidth,
  );
  const availableWidth = Math.max(0, assignedWidth - LXM_MEASURE_PADDING_X * 2);
  const totalIdealWidth = summary.columns.reduce(
    (total, column) => total + column.idealWidth,
    0,
  );
  const scale = totalIdealWidth > 0 ? availableWidth / totalIdealWidth : 1;
  const slotsByBeatId: Record<string, ILXMBeatLayout> = {};
  let cursorX = context.x + LXM_MEASURE_PADDING_X;

  summary.columns.forEach((column, columnIndex) => {
    const width = Math.max(column.minWidth, column.idealWidth * scale);

    for (const beatId of column.beatIds) {
      const beat = measure.beats.find((item) => item.id === beatId);
      if (!beat) continue;

      slotsByBeatId[beatId] = {
        id: beatId,
        measureId: measure.id,
        tick: column.tick,
        x: cursorX,
        width,
        rhythm: beat.rhythm,
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
}