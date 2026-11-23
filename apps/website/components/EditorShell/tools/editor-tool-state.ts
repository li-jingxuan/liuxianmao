import {
  resolveTabCellSelection,
  resolveTupletSelection,
  isPureTabContinuationBeat,
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
  selectedTraversalIds: readonly string[] = [],
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
  const selectedIndex =
    focused && selection && range?.beats.length === 1
      ? focused.measure.beats.findIndex(
          (beat) => beat.id === selection.focus.beatId,
        )
      : -1;
  const selectedBeat =
    selectedIndex >= 0 ? focused!.measure.beats[selectedIndex] : undefined;
  // 可选中起音向后延续，也可选中空拍延续紧邻的前音。
  const sustainSource =
    selectedBeat?.kind === "rest"
      ? focused?.measure.beats[selectedIndex - 1]
      : selectedBeat;
  const sustainReason =
    range?.beats.length !== 1
      ? "请先选择一个起音或紧随其后的空拍。"
      : focused?.measure.timeSignature.denominator !== 4
        ? "延续一拍目前用于以四分音符为单位拍的拍号。"
         : !sustainSource?.notes.length
           ? "请选择一个起音，或紧随其后的空拍。"
           : sustainSource.notes.some((note) => note.fret === "-")
             ? "横线是延音标记，请选择前面的实际起音再延续。"
           : focused.measure.tuplets.some((group) =>
                group.beatIds.includes(sustainSource.id),
              )
            ? "连音组请使用整组编辑。"
            : "";
  const selectedBeats = range?.beats.flatMap((reference) =>
    track?.measures.find((measure) => measure.id === reference.measureId)
      ?.beats.filter((beat) => beat.id === reference.beatId) ?? []) ?? [];
  const traversals = track?.techniques.filter((technique) => technique.type === "strum" || technique.type === "arpeggio") ?? [];
  const traversalBeatIds = new Set(traversals.map((technique) => technique.beatId));
  const selectedIds = new Set(selectedTraversalIds);
  const discreteRestBeatIds = [...new Set(traversals.filter((technique) => selectedIds.has(technique.id)).map((technique) => technique.beatId))];
  const discreteIds = new Set(discreteRestBeatIds);
  // 技巧对象的 TAB 矩形仅用于定位。休止只作用于离散记号所在的拍；普通矩形则覆盖完整的时间范围。
  const restBeats = track && discreteIds.size
    ? track.measures.flatMap((measure) => measure.beats.filter((beat) => discreteIds.has(beat.id)))
    : selectedBeats;
  // 有扫弦或琶音的存储休止仍有发音内容，工具应显示为可设置休止。
  const restBeatCount = restBeats.filter((beat) => beat.kind === "rest" && !traversalBeatIds.has(beat.id)).length;
  const hasContinuation = selectedBeats.some(isPureTabContinuationBeat);
  const restState: "all" | "mixed" | "none" = restBeats.length && restBeatCount === restBeats.length
    ? "all" : restBeatCount ? "mixed" : "none";
  return {
    restState,
    discreteRestBeatIds,
    range,
    focused,
    sustain: available(!sustainReason, sustainReason),
    sustainBeatId: sustainSource?.id,
    note: available(!!range, "请先选择 TAB 单元格。"),
    rhythm: available(
      range?.beats.length === 1 && !hasContinuation,
      hasContinuation ? "延音标记固定占一个单位拍，无附点。" : "时值与附点需要单拍选区，可同时选择多根弦。",
    ),
    beatRange: available(restBeats.length > 0, "请先选择目标拍点。"),
    singleMeasure: available(measureIds.size === 1, "请选择同一小节内的选区。"),
    removeMeasure: available(
      measureIds.size === 1 && !!track && track.measures.length > 1,
      "请选择一个小节，且至少保留一个小节。",
    ),
    copyMeasures: available(contiguous, "请选择连续的小节范围。"),
    splitBeat: available(range?.beats.length === 1 && !hasContinuation, hasContinuation ? "延音标记固定占一个单位拍，不能拆分。" : "拆分需要选择单拍。"),
    mergeBeats: available(
      measureIds.size === 1 && !!range && range.beats.length > 1 && !hasContinuation,
      hasContinuation ? "延音标记固定占一个单位拍，不能合并。" : "合并需要同小节内的连续多拍。",
    ),
    copyBeats: available(
      measureIds.size === 1,
      "拍点复制需要同小节内的连续范围。",
    ),
    startRepeat: available(!!focused?.isFirst, "谱首反复仅对第一小节可用。"),
    tuplet,
    tupletRatio: (actual: number) =>
      available(
        !!tuplet && tuplet.beatIds.length === actual && !hasContinuation,
        hasContinuation ? "延音标记不能设为连音成员。" : `请选择同小节内连续的 ${actual} 拍。`,
      ),
  };
};
