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

/** 音符布局结果：同一拍多根弦会共享 x，通过 string 映射到不同 y。 */
export interface LaidOutNote {
  id: string;
  beatId: string;
  measureId: string;
  fret: string;
  string: number;
  x: number;
  y: number;
  tied: boolean;
  ghost: boolean;
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

/** 音符时值布局结果：一个 notes beat 只生成一条时值标记，多弦和弦共享同一份时值几何。 */
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
  hitIndex: LayoutHitIndex;
}

export interface ScoreLayoutHit {
  measureId: string;
  beatId: string;
  tick: number;
  string: number;
}
