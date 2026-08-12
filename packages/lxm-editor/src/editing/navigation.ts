/**
 * TAB 选区的键盘导航纯函数。
 *
 * 导航只依赖文档 Beat 顺序和弦号，不依赖 layout，因此自动换行变化不会改变左右
 * 移动的业务目标。调用方只负责把返回的 focus caret 滚入可见区域。
 */
import { GUITAR_STRING_COUNT } from "../core/constants";
import type { ILXMDocument } from "../core/types";
import {
  buildOrderedBeatIndex,
  createCollapsedTabCellSelection,
  resolveTabCellSelection,
  type ILXMResolveTabCellSelectionErrorCode,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
} from "./tab-cell-selection";

export type ILXMTabCellNavigationDirection = "left" | "right" | "up" | "down";

export type ILXMNavigateTabCellSelectionResult =
  | { ok: true; changed: boolean; selection: ILXMTabCellSelection }
  | {
      ok: false;
      code: ILXMResolveTabCellSelectionErrorCode;
      message: string;
    };

const sameReference = (
  left: ILXMTabCellReference,
  right: ILXMTabCellReference,
): boolean =>
  left.trackId === right.trackId &&
  left.measureId === right.measureId &&
  left.beatId === right.beatId &&
  left.string === right.string;

/**
 * 计算一次方向键结果。
 *
 * 普通左右键遇到范围时先折叠到时间轴对应边界，不额外跨一拍；普通上下键则按
 * 产品契约从 focus 再移动一根弦。Shift 模式始终保留 anchor，只移动 focus。
 */
export const navigateTabCellSelection = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection,
  direction: ILXMTabCellNavigationDirection,
  extend = false,
): ILXMNavigateTabCellSelectionResult => {
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok) return resolved;

  const track = document.score.tracks.find(
    (candidate) => candidate.id === selection.focus.trackId,
  );
  // resolve 成功后 track 必然存在；保留守卫可防止未来重构打破该前置条件。
  if (!track)
    return {
      ok: false,
      code: "INVALID_TAB_CELL_RANGE",
      message: "TAB 单元格选区的目标轨道不存在",
    };

  const beats = buildOrderedBeatIndex(track);
  const focusIndex = beats.findIndex(
    (beat) =>
      beat.measureId === selection.focus.measureId &&
      beat.beatId === selection.focus.beatId,
  );
  const isCollapsed = sameReference(selection.anchor, selection.focus);
  let nextFocus: ILXMTabCellReference | null = null;

  if (direction === "left" || direction === "right") {
    if (!extend && !isCollapsed) {
      const edgeBeat =
        direction === "left"
          ? resolved.range.beats[0]
          : resolved.range.beats.at(-1);
      if (edgeBeat)
        nextFocus = {
          trackId: track.id,
          measureId: edgeBeat.measureId,
          beatId: edgeBeat.beatId,
          string: selection.focus.string,
        };
    } else {
      const offset = direction === "left" ? -1 : 1;
      const nextBeat = beats[focusIndex + offset];
      if (nextBeat)
        nextFocus = {
          trackId: track.id,
          measureId: nextBeat.measureId,
          beatId: nextBeat.beatId,
          string: selection.focus.string,
        };
    }
  } else {
    const offset = direction === "up" ? -1 : 1;
    const nextString = selection.focus.string + offset;
    if (nextString >= 1 && nextString <= GUITAR_STRING_COUNT)
      nextFocus = { ...selection.focus, string: nextString };
  }

  // 边界处没有相邻目标时完全保留原选区，避免“按键没移动但范围被折叠”。
  if (!nextFocus) return { ok: true, changed: false, selection };

  const nextSelection = extend
    ? { anchor: selection.anchor, focus: nextFocus }
    : createCollapsedTabCellSelection(nextFocus);
  const changed =
    !sameReference(nextSelection.anchor, selection.anchor) ||
    !sameReference(nextSelection.focus, selection.focus);
  return { ok: true, changed, selection: changed ? nextSelection : selection };
};
