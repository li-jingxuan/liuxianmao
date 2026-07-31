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

  // beat.x/width 是 measure-spacing 分配后的最终 slot，完整覆盖选择命中区域。
  return { beats, x: first.x, width: last.x + last.width - first.x };
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
      const startBounds = getStringCellBounds(
        measure.strings,
        selection.startString,
      );
      const endBounds = getStringCellBounds(
        measure.strings,
        selection.endString,
      );
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
    const stringBounds = getStringCellBounds(measure.strings, focus.string);
    if (!beat || !stringBounds) return null;

    return {
      systemIndex: system.index,
      measureId: measure.id,
      beatId: beat.id,
      string: focus.string,
      x: beat.x,
      y: stringBounds.top,
      width: beat.width,
      height: stringBounds.bottom - stringBounds.top,
    };
  }
  return null;
};
