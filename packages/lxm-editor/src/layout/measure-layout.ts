/**
 * 单小节布局模块。
 *
 * 这个模块负责把一个小节转换为可渲染的几何数据，包括小节边界、六根弦线、
 * beat 的横向位置以及音符在对应弦上的坐标。它应消费 measure-spacing 的结果，
 * 不直接决定节奏列宽策略。
 */

import type { ILXMBarlineType, ILXMBeat, ILXMMeasure } from "../core/types";
import type {
  ILXMLayoutDensity,
  ILXMMeasureLayout,
  ILXMNoteLayout,
} from "./layout-types";
import { layoutMeasureSpacing } from "./measure-spacing";
import { calculateMeasureHeight } from "./layout-helpers";
import { STANDARD_GUITAR_TUNING } from "../core/constants";
import {
  LXM_STRING_SPACING,
  LXM_STAFF_Y,
  LXM_TIME_SIGNATURE_WIDTH,
} from "./layout-constants";
import { layoutBarline } from "./barline-layout";
import { layoutDurationBeams } from "./duration-beam-layout";
import { layoutRests } from "./rest-layout";
import { layoutTimeSignature } from "./time-signature-layout";

export interface ILXMLayoutMeasureContext {
  index: number;
  /** 当前小节所属谱面行；由 system-layout 在最终定位时传入。 */
  systemIndex: number;
  x: number;
  y: number;
  /** 当前谱面的横向排版密度；由 system-layout 统一传入。 */
  density: ILXMLayoutDensity;

  /**
   * System 布局为当前小节分配的最终宽度。
   *
   * 未传入时，小节使用由节奏内容计算出的固有宽度；传入时只允许在固有宽度
   * 基础上扩张。这个值只属于布局过程，不应写回乐谱文档。
   */
  assignedWidth?: number;

  /** 由 system 层按完整文档顺序决定，measure 层只负责生成最终几何。 */
  showTimeSignature?: boolean;

  /** 前一边界为开始反复时，为圆点与拍号/第一拍预留的固定净空。 */
  leadingBarlineClearance?: number;

  /**
   * 自动换行可能把 repeatStart/repeatBoth 拆成行尾与下一行行首两部分。
   * 领域文档保持原类型，这里只覆盖当前 measure 右侧实际需要绘制的投影类型。
   */
  visualBarline?: ILXMBarlineType;

  // TODO 下面两个参数后续版本在拓展
  // 小节内和弦符号、歌词和简谱 需要的最小宽度
  // widthContributors?: ILXMColumnWidthContributors;
}

const getStringY = (y: number, string: number) => {
  return y + LXM_STAFF_Y + LXM_STRING_SPACING * (string - 1);
};

/** 构建弦线布局 */
export const buildStringLines = (x: number, y: number, width: number) => {
  return STANDARD_GUITAR_TUNING.map((line) => {
    const cursorY = getStringY(y, line.index);

    return {
      index: line.index,
      x1: x,
      y1: cursorY,

      x2: x + width,
      y2: cursorY,
      width,
    };
  });
};

/** 通过 beats 构建音符位置坐标 */
export const layoutNodes = (
  measureId: string,
  beats: ILXMBeat[],
  slotsByBeatId: ReturnType<typeof layoutMeasureSpacing>["slotsByBeatId"],
  measureY: number,
): ILXMNoteLayout[] => {
  return beats.flatMap((beat) => {
    const slot = slotsByBeatId[beat.id];

    return beat.notes.map((note) => ({
      id: note.id,
      beatId: beat.id,
      measureId,
      string: note.string,
      fret: note.fret,
      fretText: note.fret.toString(),
      x: slot.x,
      y: getStringY(measureY, note.string),
      width: slot.width,
    }));
  });
};

// 构建小节
export const layoutMeasure = (
  measure: ILXMMeasure,
  context: ILXMLayoutMeasureContext,
): ILXMMeasureLayout => {
  const {
    index,
    systemIndex,
    x,
    y,
    density,
    assignedWidth: requestedAssignedWidth,
    showTimeSignature = false,
    leadingBarlineClearance = 0,
    visualBarline = measure.barline,
  } = context;
  const leadingWidth =
    leadingBarlineClearance +
    (showTimeSignature ? LXM_TIME_SIGNATURE_WIDTH : 0);
  const { assignedWidth, columns, slotsByBeatId } = layoutMeasureSpacing(
    measure,
    {
      x,
      density,
      assignedWidth: requestedAssignedWidth,
      leadingWidth,
    },
  );

  const beats = Object.values(slotsByBeatId);
  const strings = buildStringLines(x, y, assignedWidth);
  const notes = layoutNodes(
    measure.id,
    measure.beats,
    slotsByBeatId,
    context.y,
  );

  const { beamSegments, durationMarks } = layoutDurationBeams(
    measure,
    beats,
    notes,
    strings,
  );
  // 休止符同样依赖 beat slot，确保其与后续音符共享唯一的水平时间坐标。
  const restMarks = layoutRests(
    measure.id,
    measure.beats,
    slotsByBeatId,
    strings,
  );

  return {
    id: measure.id,
    index,
    systemIndex,
    x,
    y,
    width: assignedWidth,
    barline: layoutBarline(visualBarline, strings),
    timeSignature: showTimeSignature
      ? layoutTimeSignature(measure, x, y, leadingBarlineClearance)
      : null,
    height: calculateMeasureHeight(),
    columns,
    beats,
    strings,
    notes,
    restMarks,
    beamSegments,
    durationMarks,
  };
};
