/**
 * TAB 单元格选区几何。
 *
 * 业务层负责把 anchor/focus 解析为规范矩形，本模块只把其中的 Beat/string 映射到
 * 最终 layout。页面不再猜测列宽、弦距或 system 换行位置。
 */
import type {
  ILXMResolvedTabCellRange,
  ILXMTabCellReference,
} from "../editing/tab-cell-selection";
import type {
  ILXMBeatLayout,
  ILXMLayout,
  ILXMMeasureLayout,
  ILXMStringLineLayout,
} from "./layout-types";
import { getBeatCellBounds } from "./beat-cell-bounds";
import {
  LXM_TAB_FOCUS_CARET_HEIGHT,
  LXM_TAB_FOCUS_CARET_WIDTH,
} from "./layout-constants";

/** 一个范围在单个 measure/system 内的高亮片段。 */
export interface ILXMTabCellSelectionRect {
  systemIndex: number;
  measureId: string;
  beatIds: string[];
  startString: number;
  endString: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** focus 单元格的独立几何；页面可用更强描边表达键盘输入位置。 */
export interface ILXMTabCellCaretLayout {
  systemIndex: number;
  measureId: string;
  beatId: string;
  string: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 通过相邻弦线的中点得到单元格上下边界。
 *
 * 首尾弦没有一侧邻居时复用另一侧间距。这样 compact/comfortable 或未来自定义
 * 谱面间距都直接服从 layout 产物，不把固定 12px 弦距泄漏到页面。
 */
const getStringCellBounds = (
  strings: ILXMStringLineLayout[],
  stringNumber: number,
): { top: number; bottom: number } | null => {
  const ordered = [...strings].sort((left, right) => left.index - right.index);
  const index = ordered.findIndex((string) => string.index === stringNumber);
  const current = ordered[index];
  if (!current) return null;

  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const fallbackGap = next
    ? next.y1 - current.y1
    : previous
      ? current.y1 - previous.y1
      : 0;
  const top = previous
    ? (previous.y1 + current.y1) / 2
    : current.y1 - fallbackGap / 2;
  const bottom = next
    ? (current.y1 + next.y1) / 2
    : current.y1 + fallbackGap / 2;
  return { top, bottom };
};

/**
 * 计算固定尺寸 focus caret 的几何。
 *
 * beat.x 与 string.y1 是音乐元素使用的最终时间/弦锚点。caret 必须围绕这两个
 * 锚点严格居中，不能复用更宽的点击命中边界，也不能为了留在 measure 内而 clamp，
 * 否则首尾 Beat 会再次出现肉眼可见的偏心。
 */
const getFixedFocusCaretRect = (
  beat: ILXMBeatLayout,
  string: ILXMStringLineLayout,
): Pick<ILXMTabCellCaretLayout, "x" | "y" | "width" | "height"> | null => {
  const x = beat.x - LXM_TAB_FOCUS_CARET_WIDTH / 2;
  const y = string.y1 - LXM_TAB_FOCUS_CARET_HEIGHT / 2;

  // 常量由源码控制，正常情况下始终合法。这里仍做防御性校验，避免未来修改
  // 常量或 layout 坐标后把 NaN、Infinity、零宽高继续传给 SVG。
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(LXM_TAB_FOCUS_CARET_WIDTH) ||
    !Number.isFinite(LXM_TAB_FOCUS_CARET_HEIGHT) ||
    LXM_TAB_FOCUS_CARET_WIDTH <= 0 ||
    LXM_TAB_FOCUS_CARET_HEIGHT <= 0
  ) {
    return null;
  }

  return {
    x,
    y,
    width: LXM_TAB_FOCUS_CARET_WIDTH,
    height: LXM_TAB_FOCUS_CARET_HEIGHT,
  };
};

/**
 * 单 Beat 选区的纵向范围也以固定 caret 高度为基准。
 *
 * 单弦时 range 与 caret 完全重合；连续多弦时，从首弦中心向上延伸半个 caret
 * 高度，到末弦中心向下延伸半个 caret 高度，从而完整包住 focus caret 描边。
 */
const getSingleBeatStringSpan = (
  strings: ILXMStringLineLayout[],
  startString: number,
  endString: number,
): { top: number; bottom: number } | null => {
  const start = strings.find((string) => string.index === startString);
  const end = strings.find((string) => string.index === endString);
  if (!start || !end) return null;

  return {
    top: Math.min(start.y1, end.y1) - LXM_TAB_FOCUS_CARET_HEIGHT / 2,
    bottom: Math.max(start.y1, end.y1) + LXM_TAB_FOCUS_CARET_HEIGHT / 2,
  };
};

const getBeatSpan = (
  measure: ILXMMeasureLayout,
  beatIds: Set<string>,
): { beats: ILXMBeatLayout[]; x: number; width: number } | null => {
  const beats = measure.beats
    .filter((beat) => beatIds.has(beat.id))
    .sort((left, right) => left.x - right.x);
  const first = beats[0];
  const last = beats.at(-1);
  if (!first || !last) return null;

  // 单 Beat 选区表达的是一个明确的输入列，使用固定宽度并以时间锚点居中。
  // 多 Beat 选区才需要使用宽单元格边界覆盖完整的连续选择范围。
  if (first.id === last.id) {
    return {
      beats,
      x: first.x - LXM_TAB_FOCUS_CARET_WIDTH / 2,
      width: LXM_TAB_FOCUS_CARET_WIDTH,
    };
  }

  // beat.x 是音乐元素共用的时间锚点，不是选框左边界。范围必须从首 Beat 的
  // 单元格左边界覆盖到末 Beat 的单元格右边界，才能让单格选框围绕 Beat 展开，
  // 并让连续多 Beat 选区之间既没有空隙也没有重叠。
  const firstBounds = getBeatCellBounds(measure, first.id);
  const lastBounds = getBeatCellBounds(measure, last.id);
  if (!firstBounds || !lastBounds) return null;

  return {
    beats,
    x: firstBounds.left,
    width: lastBounds.right - firstBounds.left,
  };
};

/** 将规范范围按实际 measure/system 拆成多个互不跨行的 SVG 矩形。 */
export const layoutTabCellSelection = (
  layout: ILXMLayout,
  selection: ILXMResolvedTabCellRange,
): ILXMTabCellSelectionRect[] => {
  if (layout.trackId !== selection.trackId) return [];

  const selectedBeatIds = new Set(selection.beats.map((beat) => beat.beatId));
  return layout.systems.flatMap((system) =>
    system.measures.flatMap((measure) => {
      const span = getBeatSpan(measure, selectedBeatIds);
      // 单 Beat range 与固定 caret 使用同一个垂直尺寸基准；多 Beat range 仍按
      // 弦单元格中点切分，保持既有矩形范围语义。
      const singleBeatStringSpan =
        span?.beats.length === 1
          ? getSingleBeatStringSpan(
              measure.strings,
              selection.startString,
              selection.endString,
            )
          : null;
      const startBounds =
        singleBeatStringSpan ??
        getStringCellBounds(measure.strings, selection.startString);
      const endBounds =
        singleBeatStringSpan ??
        getStringCellBounds(measure.strings, selection.endString);
      if (!span || !startBounds || !endBounds) return [];

      return [
        {
          systemIndex: system.index,
          measureId: measure.id,
          beatIds: span.beats.map((beat) => beat.id),
          startString: selection.startString,
          endString: selection.endString,
          x: span.x,
          y: startBounds.top,
          width: span.width,
          height: endBounds.bottom - startBounds.top,
        },
      ];
    }),
  );
};

/**
 * 单独布局 focus caret。
 *
 * resolved range 为了保证正反向选择等价，刻意不保存 focus 方向；因此 caret 接收
 * 原始稳定引用是必要的独立输入，而不是从规范矩形的末端猜测。
 */
export const layoutTabCellCaret = (
  layout: ILXMLayout,
  focus: ILXMTabCellReference,
): ILXMTabCellCaretLayout | null => {
  if (layout.trackId !== focus.trackId) return null;

  for (const system of layout.systems) {
    const measure = system.measures.find(
      (candidate) => candidate.id === focus.measureId,
    );
    if (!measure) continue;
    const beat = measure.beats.find(
      (candidate) => candidate.id === focus.beatId,
    );
    const string = measure.strings.find(
      (candidate) => candidate.index === focus.string,
    );
    if (!beat || !string) return null;
    const caretRect = getFixedFocusCaretRect(beat, string);
    if (!caretRect) return null;

    return {
      systemIndex: system.index,
      measureId: measure.id,
      beatId: beat.id,
      string: focus.string,
      // 固定 Rect 只表达当前活动输入位置；较宽的点击容错继续由 hit-test 使用
      // getBeatCellBounds 负责，两种几何不再互相绑死。
      ...caretRect,
    };
  }
  return null;
};
