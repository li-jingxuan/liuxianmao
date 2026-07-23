/**
 * MVP layout 类型定义模块。
 *
 * 这个模块只声明 layout 计算结果的数据形状，例如整谱布局、小节布局、弦线、
 * 音符坐标、节奏列和 beat slot。它不负责坐标计算，目的是让渲染层稳定依赖
 * 一套结构化布局产物，而不是直接理解原始乐谱数据。
 */

import type { ILXMTrack, ILXMRhythm, ILXMBarlineType } from "../core/types";

/** 后续歌词、简谱、和弦等内容通过 beatId 贡献额外列宽。 */
export interface ILXMColumnWidthContributors {
  // TODO 下面是和弦符号、歌词和简谱预留的 BeatId 对应的宽度，当前版本不靠谱
  chordSymbolWidthByBeatId?: Record<string, number>;
  lyricWidthByBeatId?: Record<string, number>;
  numberedNotationWidthByBeatId?: Record<string, number>;
}

/** 函数 buildLayout 的可选配置 */
export interface ILXMLayoutOptions {
  x?: number;
  y?: number;
  measureGap?: number;
  /** 单条谱面行的最大逻辑宽度；超过该宽度时从下一个小节开始换行。 */
  systemWidth?: number;
  /** 相邻谱面行之间的垂直间距。 */
  systemGapY?: number;
  // TODO 下面是和弦符号、歌词和简谱预留的 BeatId 对应的宽度，当前版本不靠谱
  // widthContributors?: ILXMColumnWidthContributors;
}

/** 整首谱面的布局结果；当前版本只处理 score 的第一条轨道。 */
export interface ILXMLayout {
  trackId: ILXMTrack["id"]; // string
  // x,y 是整谱在页面上的起始坐标
  x: number;
  y: number;
  // 整谱的宽度和高度(svg 需要设置 width 和 height 属性)
  width: number;
  height: number;
  /** 按自动换行结果分组的谱面行；渲染与命中均应从这里消费小节。 */
  systems: ILXMSystemLayout[];
  /** 将 SVG 逻辑坐标转换为编辑目标的只读索引。 */
  hitIndex: ILXMHitIndex;
}

/** 一条谱面行（system）的几何结果。 */
export interface ILXMSystemLayout {
  /** 从 0 开始的谱面行顺序，用于稳定渲染和编辑定位。 */
  index: number;
  /** 当前谱面行的左上角逻辑坐标。 */
  x: number;
  y: number;
  /** 当前行实际使用的宽度；超宽小节可以大于配置的 systemWidth。 */
  width: number;
  /** 当前行中最高小节决定的高度。 */
  height: number;
  /** 按原始文档顺序排列的小节布局。 */
  measures: ILXMMeasureLayout[];
}

/** 小节布局结果，包含弦线、beat slot 和音符坐标。 */
export interface ILXMMeasureLayout {
  id: string;
  index: number;
  /** 所属谱面行索引，避免页面层根据坐标反推换行归属。 */
  systemIndex: number;

  // 小节在谱面上的起始坐标
  x: number;
  y: number;
  // 小节的宽度和高度
  width: number;
  height: number;

  // 小节线布局
  barline: ILXMBarlineLayout;
  // 基于 measure.beats 原始数据计算节奏列宽 columns
  // 基于 columns 计算到的 beats(beat slot) 位置（x，width: columns.idealWidth）
  // 基于 beat.x + string.y 得到每个 note 的位置（x，y）
  columns: ILXMRhythmicColumn[];
  beats: ILXMBeatLayout[];
  // 音符和弦线布局位置信息
  strings: ILXMStringLineLayout[];
  notes: ILXMNoteLayout[];

  // beat 级别的时值符干布局，供渲染层绘制 stem。
  durationMarks: ILXMDurationMarkLayout[];
  // 连梁布局，供渲染层绘制时值连接线。
  beamSegments: ILXMBeamSegmentLayout[];

  // 小节的边界框，用于后期做命中检测、框选 等
  // bounds: [],
}

/** 小节矩形边界，用于先快速过滤不可能命中的小节。 */
export interface ILXMMeasureHitBounds {
  trackId: string;
  systemIndex: number;
  measureId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 由 layout 构建的命中索引；当前数据量较小，顺序扫描已足够。 */
export interface ILXMHitIndex {
  measureBounds: ILXMMeasureHitBounds[];
}

/** 一次成功命中得到的稳定业务位置，不保存任何临时像素坐标。 */
export interface ILXMHitTarget {
  trackId: string;
  systemIndex: number;
  measureId: string;
  beatId: string;
  string: number;
}

/** 小节内部节奏列，是 TAB、歌词、简谱未来共享的横向对齐单位。 */
export interface ILXMRhythmicColumn {
  tick: number;
  beatIds: string[];
  rhythmTicks: number;
  durationWeight: number;
  // 取最大值作为列宽
  minWidth: number;
  idealWidth: number;
}

/** beat slot 是一个真实 beat 在小节中的最终水平位置。 */
export interface ILXMBeatLayout {
  id: string;
  measureId: string;
  tick: number;
  x: number;
  width: number;
  rhythm: ILXMRhythm;
  columnIndex: number;
}

/** 单根弦线布局结果。 */
export interface ILXMStringLineLayout {
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 音符布局结果，fretText 供渲染层直接显示。 */
export interface ILXMNoteLayout {
  id: string;
  beatId: string;
  measureId: string;
  string: number;
  fret: number;
  fretText: string;
  x: number;
  y: number;
}

/** 小节线布局结果。 */
export interface ILXMBarlineLayout {
  type: ILXMBarlineType;
  parts: ILXMBarlinePartLayout[];
}

export type ILXMBarlinePartLayout =
  | ILXMBarlineLinePartLayout
  | ILXMBarlineDotPartLayout;
export interface ILXMBarlineLinePartLayout {
  kind: "line";
  x: number;
  y1: number;
  y2: number;
  strokeWidth: number;
}
export interface ILXMBarlineDotPartLayout {
  kind: "dot";
  cx: number;
  cy: number;
  radius: number;
}

interface ILXMBeamSegmentBase {
  kind: "shared" | "partial";
  measureId: string;
  beatIds: string[];
  // 连梁的层级
  level: number;
  x1: number;
  x2: number;
  y: number;
  // 连梁的厚度（也就是线宽）
  thickness: number;
}
/** 共享连梁布局 */
export interface ILXMSharedBeamSegmentLayout extends ILXMBeamSegmentBase {
  kind: "shared";
}
/** 部分连梁布局（如：附点音符） */
export interface ILXMPartialBeamSegmentLayout extends ILXMBeamSegmentBase {
  kind: "partial";
  direction: "left" | "right";
}

/** 连梁布局 */
export type ILXMBeamSegmentLayout =
  | ILXMSharedBeamSegmentLayout
  | ILXMPartialBeamSegmentLayout;

/** 单个附点的中心坐标；渲染器据此绘制圆点或对应字形。 */
export interface ILXMDurationDotAnchor {
  x: number;
  y: number;
}

/** beat 级别的时值符干布局；一个和弦 beat 只生成一个符干。 */
export interface ILXMDurationMarkLayout {
  beatId: string;
  measureId: string;

  // 符干坐标
  stemX: number;
  stemY1: number;
  stemY2: number;

  // 连梁 Y 坐标
  beamY: number;
  // 连梁层级
  beamLevel: number;

  /** 原始 rhythm 中的附点数量。 */
  dots: number;
  /** 每个附点的布局中心；无附点时为空数组。 */
  dotAnchors: ILXMDurationDotAnchor[];
}
