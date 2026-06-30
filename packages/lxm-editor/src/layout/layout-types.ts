/**
 * MVP layout 类型定义模块。
 *
 * 这个模块只声明 layout 计算结果的数据形状，例如整谱布局、小节布局、弦线、
 * 音符坐标、节奏列和 beat slot。它不负责坐标计算，目的是让渲染层稳定依赖
 * 一套结构化布局产物，而不是直接理解原始乐谱数据。
 */

import type { ILXMTrack, ILXMRhythm } from "../core/types";

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
  // TODO 下面是和弦符号、歌词和简谱预留的 BeatId 对应的宽度，当前版本不靠谱
  // widthContributors?: ILXMColumnWidthContributors;
}

/** 函数 buildLayout 响应值，当前版本只处理单轨 */
export interface ILXMLayout {
  trackId: ILXMTrack["id"]; // string
  // x,y 是整谱在页面上的起始坐标
  x: number,
  y: number,
  // 整谱的宽度和高度(svg 需要设置 width 和 height 属性)
  width: number,
  height: number,
  // 小节布局结果
  measures: ILXMMeasureLayout[];
}

/** 小节布局结果，包含弦线、beat slot 和音符坐标。 */
export interface ILXMMeasureLayout {
  id: string;
  index: number;
  // 小节在谱面上的起始坐标
  x: number;
  y: number;
  // 小节的宽度和高度
  width: number;
  height: number;

  // 基于 measure.beats 原始数据计算节奏列宽 columns
  // 基于 columns 计算到的 beats(beat slot) 位置（x，width: columns.idealWidth）
  // 基于 beat.x + string.y 得到每个 note 的位置（x，y）
  columns: ILXMRhythmicColumn[],
  beats: ILXMBeatLayout[],
  // 音符和弦线布局位置信息
  strings: ILXMStringLineLayout[],
  notes: ILXMNoteLayout[],

  // 小节的边界框，用于后期做命中检测、框选 等
  // bounds: [],
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
