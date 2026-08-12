/**
 * MVP layout 类型定义模块。
 *
 * 这个模块只声明 layout 计算结果的数据形状，例如整谱布局、小节布局、弦线、
 * 音符坐标、节奏列和 beat slot。它不负责坐标计算，目的是让渲染层稳定依赖
 * 一套结构化布局产物，而不是直接理解原始乐谱数据。
 */

import type {
  ILXMTrack,
  ILXMRhythm,
  ILXMBarlineType,
  ILXMTechniqueType,
} from "../core/types";

/** 谱面横向排版密度；默认舒适模式保持既有几何，紧凑模式用于纸张排版。 */
export type ILXMLayoutDensity = "comfortable" | "compact";

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
  /**
   * 普通谱面行的目标逻辑宽度，同时也是断行上限；单个超宽小节保留真实宽度。
   */
  systemWidth?: number;
  /** 相邻谱面行之间的垂直间距。 */
  systemGapY?: number;
  /** 小节与 beat column 的横向排版密度；省略时使用 comfortable。 */
  density?: ILXMLayoutDensity;
  // TODO 下面是和弦符号、歌词和简谱预留的 BeatId 对应的宽度，当前版本不靠谱
  // widthContributors?: ILXMColumnWidthContributors;
}

/** 整首谱面的布局结果；当前版本只处理 score 的第一条轨道。 */
export interface ILXMLayout {
  trackId: ILXMTrack["id"]; // string
  // x,y 是整谱在页面上的起始坐标
  x: number;
  y: number;
  /**
   * 整谱画布的宽度和高度（SVG 用于设置 width、height 与 viewBox）。
   * 非空布局的 width 至少为配置的 systemWidth；它可以大于稀疏末行的实际宽度。
   */
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
  /**
   * 当前行的实际绘制宽度。正文多小节行通常等于配置 systemWidth；稀疏末行或
   * 单小节行可以更短，超宽小节行可以更长。
   */
  width: number;
  /** 当前行中最高小节决定的高度。 */
  height: number;
  /** 行头包含 TAB 文字及由谱首/跨行反复边界投影出的可选小节线。 */
  header: ILXMSystemHeaderLayout;
  /** 按原始文档顺序排列的小节布局。 */
  measures: ILXMMeasureLayout[];
  /** 技巧已经按当前 systemWidth 拆段并生成最终 SVG 几何。 */
  techniques: ILXMTechniqueSegmentLayout[];
  /** system 上方技巧区占用的 lane 数；staff 内局部记号不计入。 */
  techniqueLaneCount: number;
}

export type ILXMTechniqueContinuation =
  | "none"
  | "fromPrevious"
  | "toNext"
  | "both";

/** 页面直接消费 SVG path；任何弧线、波浪或箭头计算都留在核心 layout。 */
export interface ILXMTechniquePathLayout {
  d: string;
  strokeWidth: number;
  dashArray?: string;
  markerEnd?: "arrow";
}

export interface ILXMTechniqueSegmentLayout {
  techniqueId: string;
  type: ILXMTechniqueType;
  systemIndex: number;
  segmentIndex: number;
  continuation: ILXMTechniqueContinuation;
  /** -1 表示 staff 内局部记号；非负数表示 system 上方 lane。 */
  lane: number;
  path: ILXMTechniquePathLayout | null;
  texts: ILXMTextLayout[];
  bounds: { x: number; y: number; width: number; height: number };
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
  /** 第一小节或拍号变化点的最终文字几何；其他小节为 null。 */
  timeSignature: ILXMTimeSignatureLayout | null;
  // 基于 measure.beats 原始数据计算节奏列宽 columns
  // 基于 columns 计算到的 beats(beat slot) 位置（x，width: columns.idealWidth）
  // 基于 beat.x + string.y 得到每个 note 的位置（x，y）
  columns: ILXMRhythmicColumn[];
  beats: ILXMBeatLayout[];
  // 音符和弦线布局位置信息
  strings: ILXMStringLineLayout[];
  notes: ILXMNoteLayout[];
  /** 休止符由核心 layout 产出，页面只按 glyph 与坐标渲染。 */
  restMarks: ILXMRestLayout[];

  // beat 级别的时值符干布局，供渲染层绘制 stem。
  durationMarks: ILXMDurationMarkLayout[];
  // 连梁布局，供渲染层绘制时值连接线。
  beamSegments: ILXMBeamSegmentLayout[];

  // 小节的边界框，用于后期做命中检测、框选 等
  // bounds: [],
}

/** 页面可直接映射为 SVG text 的最终文字几何。 */
export interface ILXMTextLayout {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  textAnchor: "start" | "middle" | "end";
}

/** 每条 system 的固定行头；六根弦线贯穿该区域，staffX 是第一小节的真实起点。 */
export interface ILXMSystemHeaderLayout {
  width: number;
  staffX: number;
  /** 纵向排列的 T、A、B 三个字母，页面无需再拆分或计算行距。 */
  tabLetters: ILXMTextLayout[];
  /** 从 system 左边缘延伸到第一小节的六根弦线，避免 TAB 左侧形成视觉空白。 */
  strings: ILXMStringLineLayout[];
  leadingBarline: ILXMBarlineLayout | null;
}

/** 拍号分子、分母分别布局，渲染层无需理解排版规则。 */
export interface ILXMTimeSignatureLayout {
  measureId: string;
  width: number;
  numerator: ILXMTextLayout;
  denominator: ILXMTextLayout;
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
  techniqueBounds: ILXMTechniqueHitBounds[];
}

/** 技巧命中只返回稳定技巧 ID；多段跨行几何共享同一个领域目标。 */
export interface ILXMTechniqueHitBounds {
  trackId: string;
  techniqueId: string;
  systemIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

/** 单个休止 beat 的图形信息；glyph 使用 Bravura/SMuFL 私有区字符。 */
export interface ILXMRestLayout {
  id: string;
  beatId: string;
  measureId: string;
  rhythm: ILXMRhythm;
  x: number;
  y: number;
  glyph: string;
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

/** 页面可直接使用 Bravura 渲染的时值字形及其最终坐标。 */
export interface ILXMDurationGlyphLayout {
  glyph: string;
  x: number;
  y: number;
  fontSize: number;
}

/**
 * 长时值中，一个四分音符单位之后的延续占位线。
 *
 * `unitIndex` 从 1 开始：0 号单位由当前拍的符干表示，后续单位才绘制占位线。
 * 布局层输出最终线段坐标，渲染层不再重复推导拍宽或时值单位。
 */
export interface ILXMDurationSustainMarkLayout {
  unitIndex: number;
  x1: number;
  x2: number;
  y: number;
  thickness: number;
}

/** beat 级别的时值布局；一个和弦 beat 只生成一套节奏头、符干和旗帜。 */
export interface ILXMDurationMarkLayout {
  beatId: string;
  measureId: string;

  /** 六线谱下方固定 rhythm lane 中的节奏头。 */
  head: ILXMDurationGlyphLayout;

  /** 所有音符时值都绘制符干；长时值再由 sustainMarks 补足持续单位。 */
  stemVisible: boolean;
  // 符干坐标
  stemX: number;
  stemY1: number;
  stemY2: number;

  // 连梁 Y 坐标
  beamY: number;
  // 连梁层级
  beamLevel: number;

  /** 二分、全音符剩余四分音符单位的时间占位线。 */
  sustainMarks: ILXMDurationSustainMarkLayout[];

  /** 仅完全没有连梁覆盖的孤立短时值使用 composite flag。 */
  flag: ILXMDurationGlyphLayout | null;

  /** 原始 rhythm 中的附点数量。 */
  dots: number;
  /** 每个附点的布局中心；无附点时为空数组。 */
  dotAnchors: ILXMDurationDotAnchor[];
}
