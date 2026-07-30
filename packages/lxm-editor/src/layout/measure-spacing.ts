import { calculateRhythmTicks } from "../core/rhythm";
import type { ILXMBeat, ILXMMeasure } from "../core/types";
import {
  LXM_DURATION_MIN_COLUMN_WIDTH,
  LXM_DURATION_VISUAL_WEIGHT,
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
type ILXMSummarizeMeasureSpacingWidth = Omit<
  ILXMMeasureSpacingSummary,
  "slotsByBeatId"
> & {
  // 小节内容的宽度（不包含左右边距）
  contentWidth: number;
};

/** 计算当前拍的节奏 tick 数量 */
const getBeatRhythmTicks = (beat: ILXMBeat): number => {
  const result = calculateRhythmTicks(beat.rhythm);

  if (!result.ok) {
    throw new Error(`无法把 ${beat.rhythm} 切成合法节奏片段`);
  }

  return result.ticks;
};

/** 构建节奏列；同一 tick 的 TAB、歌词、简谱未来会共享这一列。 */
export const buildRhythmicColumns = (
  measure: ILXMMeasure,
): ILXMRhythmicColumn[] => {
  // 当前只需要考虑 notes 类型的节拍
  // 数据结构中暂时不考虑相同 tick 存在多个 beat（节拍）的情况：多轨和多声部才可能出现这种情况
  return (
    [...measure.beats]
      // 先复制再排序；layout 是纯计算，绝不能改变调用方的文档 beat 顺序。
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
          // TODO 这里应该多种因素来计算小节理想宽度
          idealWidth: Math.max(minWidth, minWidth * durationWeight),
        };
      })
  );
};

export const summarizeMeasureSpacingWidth = (
  measure: ILXMMeasure,
): ILXMSummarizeMeasureSpacingWidth => {
  // 计算每个 beat 节拍列信息
  const columns = buildRhythmicColumns(measure);
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

  const assignedWidth = Math.max(idealWidth, minWidth);

  return {
    measureId: measure.id,
    // 理想宽度 和 最小宽度
    minWidth,
    idealWidth,
    columns,
    // 小节分配的宽度
    assignedWidth,
    // 小节内容的宽度（不包含左右边距）
    contentWidth: assignedWidth - measurePaddingX,
  };
};

/**
 * 将节奏列转换成最终 beat slot。
 *
 * 小节左右 padding 始终保持固定；System 分配的额外宽度只进入节奏内容区，并按
 * 每个 column 的固有 idealWidth 成比例分配。因此该函数不会通过放大首尾空白来
 * 假装对齐，小节中的拍点、音符、休止符和后续命中区域都会使用真实拉伸后的坐标。
 */
export const layoutMeasureSpacing = (
  measure: ILXMMeasure,
  context: {
    x: number;
    /** 由 System 分配的最终宽度；省略时使用小节固有宽度。 */
    assignedWidth?: number;
  },
): ILXMMeasureSpacingSummary => {
  // summary 中的 assignedWidth 是仅由节奏内容推导出的固有宽度。为了避免把
  // “固有宽度”和“最终分配宽度”混在一起，下面分别保留两个变量。
  const summary = summarizeMeasureSpacingWidth(measure);
  const intrinsicWidth = summary.assignedWidth;
  const assignedWidth = context.assignedWidth ?? intrinsicWidth;

  // 本轮算法只负责扩张。若允许 assignedWidth 落在 minWidth 和 idealWidth
  // 之间，extraWidth 会变成负数并悄悄压缩节奏列，违背 System 对齐的契约。
  // EPSILON 只容忍上层残差吸收可能带来的机器精度误差，不允许真实压缩。
  const widthEpsilon = Number.EPSILON * Math.max(1, intrinsicWidth) * 8;
  if (
    !Number.isFinite(assignedWidth) ||
    assignedWidth + widthEpsilon < intrinsicWidth
  ) {
    throw new RangeError(
      `assignedWidth 必须是大于等于小节固有宽度 ${intrinsicWidth} 的有限数值，实际为 ${assignedWidth}`,
    );
  }

  const extraWidth = assignedWidth - intrinsicWidth;
  const assignedContentWidth = assignedWidth - LXM_MEASURE_PADDING_X * 2;
  let allocatedContentWidth = 0;

  // 计算每个 beat 节拍的x坐标信息
  const slotsByBeatId: Record<string, ILXMBeatLayout> = {};
  // 当前 x 游标位置
  let cursorX = context.x + LXM_MEASURE_PADDING_X;
  summary.columns.forEach((column, columnIndex) => {
    const isLastColumn = columnIndex === summary.columns.length - 1;
    // 前 n - 1 列按 idealWidth 比例获得额外空间；最后一列直接吸收内容区剩余值，
    // 避免多次浮点加法让最后一个 slot 偏离右 padding。
    const proportionalWidth =
      summary.contentWidth > 0
        ? column.idealWidth +
          (extraWidth * column.idealWidth) / summary.contentWidth
        : column.idealWidth;
    const width = isLastColumn
      ? assignedContentWidth - allocatedContentWidth
      : proportionalWidth;

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
    allocatedContentWidth += width;
  });

  return {
    ...summary,
    assignedWidth,
    slotsByBeatId,
  };
};
