/** 连音编辑只关心同小节的连续 Beat；弦范围与拖动方向不改变结果。 */
import type { ILXMDocument } from "../core/types";
import {
  resolveTabCellSelection,
  type ILXMTabCellSelection,
} from "./tab-cell-selection";
export const resolveTupletSelection = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
) => {
  if (!selection) return null;
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok) return null;
  const first = resolved.range.beats[0]!,
    last = resolved.range.beats.at(-1)!;
  if (first.measureId !== last.measureId) return null;
  const track = document.score.tracks.find(
    (track) => track.id === resolved.range.trackId,
  )!;
  const measure = track.measures.find(
    (measure) => measure.id === first.measureId,
  )!;
  const beatIds = resolved.range.beats.map((beat) => beat.beatId);
  const group = measure.tuplets.find(
    (group) =>
      group.beatIds.length === beatIds.length &&
      group.beatIds.every((id, index) => id === beatIds[index]),
  );
  return {
    trackId: track.id,
    measureId: measure.id,
    startBeatId: first.beatId,
    endBeatId: last.beatId,
    beatIds,
    group,
  };
};
