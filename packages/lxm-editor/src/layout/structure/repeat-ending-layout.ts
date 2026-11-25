import type { ILXMMeasure, ILXMRepeatEnding } from "../../core/types";
import type { ILXMRepeatEndingSegmentLayout, ILXMSystemLayout } from "../layout-types";

export const REPEAT_ENDING_LANE_HEIGHT = 16;

/** 以真实小节左右边界裁切，每段占同一个谱行高度，只有最后一段闭合。 */
export function layoutRepeatEndingSegments(
  system: ILXMSystemLayout,
  endings: readonly ILXMRepeatEnding[],
  sourceIndexes: ReadonlyMap<ILXMMeasure["id"], number>,
  top: number,
): ILXMRepeatEndingSegmentLayout[] {
  const first = system.measures[0];
  const last = system.measures.at(-1);
  if (!first || !last) return [];
  return endings.flatMap((ending) => {
    const start = sourceIndexes.get(ending.startMeasureId);
    const end = sourceIndexes.get(ending.endMeasureId);
    if (start === undefined || end === undefined || start > end || start > last.index || end < first.index) return [];
    const from = system.measures[Math.max(first.index, start) - first.index]!;
    const through = system.measures[Math.min(last.index, end) - first.index]!;
    const starts = from.index === start;
    const label = ending.passes.map((pass) => `${pass}.`).join(", ");
    return [{
      id: ending.id,
      startMeasureId: ending.startMeasureId,
      endMeasureId: ending.endMeasureId,
      label: starts ? label : `(${label})`,
      starts,
      ends: through.index === end,
      bounds: { x: from.x, y: top, width: through.x + through.width - from.x, height: REPEAT_ENDING_LANE_HEIGHT },
    }];
  });
}
