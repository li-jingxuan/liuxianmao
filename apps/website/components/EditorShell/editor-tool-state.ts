import {
  resolveTabCellSelection,
  resolveTupletSelection,
  type ILXMDocument,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";

export interface ToolAvailability {
  enabled: boolean;
  reason: string;
}
const available = (enabled: boolean, reason: string): ToolAvailability => ({
  enabled,
  reason: enabled ? "" : reason,
});

/** 只派生入口条件，音乐合法性继续由核心命令判定。 */
export const deriveEditorToolState = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
) => {
  const result = selection
    ? resolveTabCellSelection(document, selection)
    : null;
  const range = result?.ok ? result.range : null;
  const measureIds = new Set(range?.beats.map((beat) => beat.measureId));
  const track = range
    ? document.score.tracks.find((item) => item.id === range.trackId)
    : undefined;
  const focusIndex =
    track && selection
      ? track.measures.findIndex(
          (measure) => measure.id === selection.focus.measureId,
        )
      : -1;
  const focused =
    track && focusIndex >= 0
      ? {
          track,
          measure: track.measures[focusIndex]!,
          index: focusIndex,
          isFirst: focusIndex === 0,
          isLast: focusIndex === track.measures.length - 1,
        }
      : null;
  const indexes =
    track?.measures.flatMap((measure, index) =>
      measureIds.has(measure.id) ? [index] : [],
    ) ?? [];
  const contiguous =
    indexes.length > 0 && indexes.at(-1)! - indexes[0]! + 1 === indexes.length;
  const tuplet = resolveTupletSelection(document, selection);
  return {
    range,
    focused,
    note: available(!!range, "请先选择 TAB 单元格。"),
    rhythm: available(
      range?.beats.length === 1,
      "时值与附点需要单拍选区，可同时选择多根弦。",
    ),
    beatRange: available(!!range?.beats.length, "请先选择目标拍点。"),
    singleMeasure: available(measureIds.size === 1, "请选择同一小节内的选区。"),
    removeMeasure: available(
      measureIds.size === 1 && !!track && track.measures.length > 1,
      "请选择一个小节，且至少保留一个小节。",
    ),
    copyMeasures: available(contiguous, "请选择连续的小节范围。"),
    splitBeat: available(range?.beats.length === 1, "拆分需要选择单拍。"),
    mergeBeats: available(
      measureIds.size === 1 && !!range && range.beats.length > 1,
      "合并需要同小节内的连续多拍。",
    ),
    copyBeats: available(
      measureIds.size === 1,
      "拍点复制需要同小节内的连续范围。",
    ),
    startRepeat: available(!!focused?.isFirst, "谱首反复仅对第一小节可用。"),
    tuplet,
    tupletRatio: (actual: number) =>
      available(
        !!tuplet && tuplet.beatIds.length === actual,
        `请选择同小节内连续的 ${actual} 拍。`,
      ),
  };
};
