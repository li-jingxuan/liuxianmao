/** 连音标注的全部几何留在核心层，页面无需推导连音范围或括号路径。 */
import type { ILXMMeasure } from "../core/types";
import type {
  ILXMBeatLayout,
  ILXMBeamSegmentLayout,
  ILXMDurationMarkLayout,
  ILXMRestLayout,
  ILXMStringLineLayout,
  ILXMTupletLayout,
} from "./layout-types";
import {
  LXM_DURATION_FLAG_DESCENT,
  LXM_TUPLET_FONT_SIZE,
  LXM_TUPLET_CLEARANCE,
  LXM_TUPLET_HOOK,
  LXM_TUPLET_GAP,
  LXM_TUPLET_STROKE,
} from "./layout-constants";

export const layoutTuplets = (
  measure: ILXMMeasure,
  beats: ILXMBeatLayout[],
  beams: ILXMBeamSegmentLayout[],
  marks: ILXMDurationMarkLayout[],
  rests: ILXMRestLayout[],
  strings: ILXMStringLineLayout[],
): ILXMTupletLayout[] => {
  const byBeat = new Map(beats.map((beat) => [beat.id, beat]));
  // 统一标注 lane 位于目标小节所有节奏图形之下，保守包含旗帜字体下缘。
  const lowest = Math.max(
    ...strings.map((line) => line.y1),
    ...beams.map((beam) => beam.y + beam.thickness / 2),
    ...marks.map((mark) =>
      Math.max(
        mark.stemY2,
        mark.flag ? mark.flag.y + LXM_DURATION_FLAG_DESCENT : mark.stemY2,
        ...mark.dotAnchors.map((dot) => dot.y + 2),
      ),
    ),
    ...rests.map((rest) => rest.y + 18),
  );
  const labelY = lowest + LXM_TUPLET_CLEARANCE + LXM_TUPLET_FONT_SIZE;
  return measure.tuplets.map((group) => {
    const first = byBeat.get(group.beatIds[0]!)!;
    const last = byBeat.get(group.beatIds.at(-1)!)!;
    const x1 = first.x,
      x2 = last.x,
      x = (x1 + x2) / 2;
    const text = String(group.ratio.actual);
    const y = labelY - LXM_TUPLET_FONT_SIZE / 3;
    const halfGap = text.length * LXM_TUPLET_FONT_SIZE * 0.35 + LXM_TUPLET_GAP;
    const gapX1 = x - halfGap,
      gapX2 = x + halfGap;
    return {
      id: group.id,
      measureId: measure.id,
      beatIds: group.beatIds,
      ratio: group.ratio,
      label: {
        text,
        x,
        y: labelY,
        fontSize: LXM_TUPLET_FONT_SIZE,
        textAnchor: "middle",
      },
      // 连音组始终显示数字和范围括号；连梁覆盖不决定标注形式。
      bracket: {
        x1,
        x2,
        y,
        hookLength: LXM_TUPLET_HOOK,
        gapX1,
        gapX2,
        strokeWidth: LXM_TUPLET_STROKE,
        lines: [
          { x1, x2: gapX1, y1: y, y2: y },
          { x1: gapX2, x2, y1: y, y2: y },
          { x1, x2: x1, y1: y, y2: y - LXM_TUPLET_HOOK },
          { x1: x2, x2, y1: y, y2: y - LXM_TUPLET_HOOK },
        ],
      },
    };
  });
};
