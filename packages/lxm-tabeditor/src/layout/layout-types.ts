import type {
  Beat,
  Measure,
  RhythmValue,
  TimeSignature,
  TupletGroup,
} from "../core/schema";

/**
 * layout 层公共类型定义。
 *
 * 这个模块只负责声明“排版产物长什么样”，不负责任何具体坐标计算。
 * 这样做的目的是把数据形状和算法实现解耦，后续无论拆分 measure、duration
 * 还是 hit-test 逻辑，调用方都能稳定依赖同一套类型。
 */

/** layoutScore 的外部输入只保留缩放和测试覆盖用的固定宽度，不再读取容器宽度。 */
export interface ScoreLayoutOptions {
  zoom?: number;
  width?: number;
  measuresPerSystem?: number;
  editingRhythm?: RhythmValue;
}

/** 矩形边界统一使用 SVG 坐标，供命中测试和可视区域计算复用。 */
export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 按领域 id 建立几何索引。
 * Iteration 3 的点击、框选和键盘定位可以直接查这个索引，避免重新遍历 layout 树。
 */
export interface LayoutHitIndex {
  measures: Record<string, LayoutBounds>;
  beats: Record<string, LayoutBounds>;
  notes: Record<string, LayoutBounds>;
}

/** 拍点布局结果：x 是拍点起始位置，width 是该拍时值在当前小节内占用的水平长度。 */
export interface LaidOutBeat {
  id: string;
  measureId: string;
  kind: Beat["kind"];
  tick: number;
  x: number;
  width: number;
  rhythm: RhythmValue;
}

/** 编辑网格 slot 来源：真实 beat 覆盖区或小节时间空洞。 */
export type EditGridSlotKind = "beat" | "gap";

/**
 * 编辑态派生出的 beat slot。
 *
 * beat slot 对应真实 beat 覆盖的时间区间；只有首个 slot 会同时暴露 `beatId`，
 * 其他细分 slot 通过 `coveringBeatId` 回指原始 beat，供命令层做 materialize。
 */
export interface LaidOutBeatEditGridSlot {
  id: string;
  kind: "beat";
  measureId: string;
  beatId?: string;
  coveringBeatId: string;
  tick: number;
  x: number;
  width: number;
  isBeatStart: boolean;
}

/**
 * 编辑态派生出的 gap slot。
 *
 * gap slot 不对应真实 beat，只描述“这段时间线还没有音乐事件，但当前编辑时值
 * 可以在这里落盘”。命令层需要依赖 gapStartTick / gapEndTick 把写入 materialize
 * 成真实 beat/rest。
 */
export interface LaidOutGapEditGridSlot {
  id: string;
  kind: "gap";
  measureId: string;
  tick: number;
  x: number;
  width: number;
  gapStartTick: number;
  gapEndTick: number;
  isBeatStart: false;
}

export type LaidOutEditGridSlot =
  | LaidOutBeatEditGridSlot
  | LaidOutGapEditGridSlot;

export interface MeasureEditGrid {
  rhythm: RhythmValue;
  slots: LaidOutEditGridSlot[];
}

/** 音符布局结果：同一拍多根弦会共享 x，通过 string 映射到不同 y。 */
export interface LaidOutNote {
  id: string;
  beatId: string;
  measureId: string;
  fret: string;
  string: number;
  x: number;
  y: number;
  tieTargetNoteId?: string;
  ghost: boolean;
}

/** tie 的实际渲染片段；跨行时一条逻辑 tie 会拆成多个 segment。 */
export interface LaidOutTieSegment {
  id: string;
  tieId: string;
  systemIndex: number;
  role: "single" | "start" | "middle" | "end";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** tie 的逻辑关系，保留源/目标音符信息，供调试和后续编辑能力扩展。 */
export interface LaidOutTie {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  fromMeasureId: string;
  toMeasureId: string;
  segments: LaidOutTieSegment[];
}

/** 休止符布局结果：symbol 使用 Bravura 的 SMuFL 私用区码点，普通文本不使用该字体。 */
export interface LaidOutRest {
  id: string;
  measureId: string;
  rhythm: RhythmValue;
  symbol: string;
  x: number;
  y: number;
}

/** 小节内部节奏列：未来歌词、简谱和 TAB 都会围绕它做水平对齐。 */
export interface RhythmicColumn {
  /** 小节内 tick 位置；TAB、歌词和简谱未来会共享同一列。 */
  tick: number;
  /** 落在该 tick 上的一组 beat id。 */
  beatIds: string[];
  /** 视觉排版权重，只影响水平距离，不改变真实音乐时间。 */
  durationWeight: number;
  /** 当前列的最小可读宽度。 */
  minWidth: number;
  /** 当前列的理想宽度。 */
  idealWidth: number;
}

export interface BeatSpacingSlot {
  /** 对应 beat id。 */
  beatId: string;
  /** 小节内 tick 位置。 */
  tick: number;
  /** 最终 SVG x 坐标。 */
  x: number;
  /** 当前 beat 到下一列或小节尾之间的视觉宽度。 */
  width: number;
  /** 对应 rhythmic column 下标。 */
  columnIndex: number;
}

export interface MeasureSpacingSummary {
  /** 对应 measure id。 */
  measureId: string;
  /** 小节不可再压缩的宽度。 */
  minWidth: number;
  /** 小节在当前内容下的理想宽度。 */
  idealWidth: number;
  /** system 最终分配给小节的宽度。 */
  assignedWidth: number;
  /** 小节内部的节奏列。 */
  columns: RhythmicColumn[];
  /** beat id 到最终视觉位置的映射。 */
  slotsByBeatId: Record<string, BeatSpacingSlot>;
}

/** 音符时值布局结果：一个 notes beat 只生成一条时值标记，多弦和弦共享同一份时值几何。 */
export interface LaidOutDurationFlagAnchor {
  /** 符尾/连梁层级，八分为第 1 层，三十二分最多到第 3 层。 */
  level: 1 | 2 | 3;
  /** 当前层级符尾的起始 x 坐标。 */
  x: number;
  /** 当前层级符尾的起始 y 坐标，和同层连梁共用同一套公式。 */
  y: number;
}

export interface LaidOutDurationMark {
  beatId: string;
  measureId: string;
  x: number;
  y: number;
  base: RhythmValue["base"];
  dots: RhythmValue["dots"];
  notehead: "whole" | "half" | "filled";
  hasStem: boolean;
  stemX: number;
  stemTopY: number;
  stemBaseY: number;
  stemBottomY: number;
  flagCount: 0 | 1 | 2 | 3;
  /** 每一层独立符尾的锚点；已被 beam 覆盖的层级由页面层跳过绘制。 */
  flagAnchors: LaidOutDurationFlagAnchor[];
  /** 附点锚点独立于符尾层级，避免三十二分音符时贴到多层符尾上。 */
  dot: { x: number; y: number };
}

interface BaseBeamSegment {
  measureId: string;
  level: 1 | 2 | 3;
  x1: number;
  x2: number;
  y: number;
}

/** 完整共享连梁：一组连续 beat 在同一层级上共享一条横线。 */
export interface LaidOutSharedBeam extends BaseBeamSegment {
  kind: "shared";
  beatIds: string[];
}

/** partial beam：单个 beat 在更高层级上的短横线，常见于附点八分 + 十六分组合。 */
export interface LaidOutPartialBeam extends BaseBeamSegment {
  kind: "partial";
  beatId: string;
  direction: "left" | "right";
}

/** 连梁片段统一模型：页面层通过 kind 明确区分完整共享连梁与 partial beam。 */
export type LaidOutBeamSegment = LaidOutSharedBeam | LaidOutPartialBeam;

/** 判断 beam segment 是否为完整共享连梁，供 filter/find 时获得准确类型收窄。 */
export const isLaidOutSharedBeam = (
  segment: LaidOutBeamSegment,
): segment is LaidOutSharedBeam => segment.kind === "shared";

/** 判断 beam segment 是否为 partial beam，避免调用方用隐式字段猜测片段类型。 */
export const isLaidOutPartialBeam = (
  segment: LaidOutBeamSegment,
): segment is LaidOutPartialBeam => segment.kind === "partial";

/** 连音组括号布局结果：x1/x2 覆盖连音组从首拍开始到末拍结束的范围。 */
export interface LaidOutTuplet {
  id: string;
  measureId: string;
  number: number;
  x1: number;
  x2: number;
  y: number;
  bracket: Exclude<TupletGroup["bracket"], "hide">;
}

/** 小节布局结果，包含渲染小节所需的所有局部几何信息。 */
export interface LaidOutMeasure {
  id: string;
  index: number;
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  staffTop: number;
  staffHeight: number;
  stringSpacing: number;
  capacityTicks: number;
  timeSignature: TimeSignature;
  showTimeSignature: boolean;
  barline: Measure["barline"];
  beats: LaidOutBeat[];
  notes: LaidOutNote[];
  rests: LaidOutRest[];
  durationMarks: LaidOutDurationMark[];
  beamSegments: LaidOutBeamSegment[];
  tuplets: LaidOutTuplet[];
  spacing: MeasureSpacingSummary;
  editGrid?: MeasureEditGrid;
}

/** system 表示一行谱表；当前只排第一条吉他轨，但结构允许后续扩展多轨。 */
export interface LaidOutSystem {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  measures: LaidOutMeasure[];
}

/** 完整谱面 layout 输出，页面层只需遍历 systems 即可绘制。 */
export interface ScoreLayout {
  width: number;
  height: number;
  zoom: number;
  tempo: number;
  systems: LaidOutSystem[];
  ties: LaidOutTie[];
  hitIndex: LayoutHitIndex;
}

export interface ScoreLayoutHit {
  measureId: string;
  beatId?: string;
  tick: number;
  string: number;
  slotId?: string;
  slotKind?: EditGridSlotKind;
  gapStartTick?: number;
  gapEndTick?: number;
}
