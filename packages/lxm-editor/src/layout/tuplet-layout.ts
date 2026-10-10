/** 连音标注的全部几何留在核心层，页面无需推导连音范围或括号路径。 */
import type { ILXMMeasure } from "../core/types";
import type {
  ILXMBeatLayout,
  ILXMBeamSegmentLayout,
  ILXMDurationMarkLayout,
  ILXMRestLayout,
  ILXMStringLineLayout,
  ILXMTupletLayout,
  ILXMMeasureLayout,
} from "./layout-types";
import {
  LXM_TUPLET_FONT_SIZE,
  LXM_TUPLET_CLEARANCE,
  LXM_TUPLET_HOOK,
  LXM_TUPLET_GAP,
  LXM_TUPLET_STROKE,
  LXM_TUPLET_BOTTOM_PADDING,
} from "./layout-constants";
import { getRhythmBottom } from "./rhythm-bounds";

/** 同一谱行共用最深的连音标注带；平移完整括号，保留首末 Beat 锚点。 */
export const alignSystemTuplets = (
  measures: ILXMMeasureLayout[],
): ILXMMeasureLayout[] => {
  const groups = measures.flatMap((measure) => measure.tuplets);
  if (groups.length === 0) return measures;
  const labelY = Math.max(...groups.map((group) => group.label.y));
  return measures.map((measure) => {
    if (measure.tuplets.length === 0) return measure;
    return {
      ...measure,
      // 先更新小节下缘，再由 System 规划歌词与后续谱行，避免标注被覆盖。
      height: Math.max(
        measure.height,
        labelY + LXM_TUPLET_BOTTOM_PADDING - measure.y,
      ),
      tuplets: measure.tuplets.map((group) => {
        const dy = labelY - group.label.y;
        return {
          ...group,
          label: { ...group.label, y: labelY },
          bracket: group.bracket
            ? {
                ...group.bracket,
                y: group.bracket.y + dy,
                lines: group.bracket.lines.map((line) => ({
                  ...line,
                  y1: line.y1 + dy,
                  y2: line.y2 + dy,
                })),
              }
            : null,
        };
      }),
    };
  });
};

export const layoutTuplets = (
  measure: ILXMMeasure,
  beats: ILXMBeatLayout[],
  beams: ILXMBeamSegmentLayout[],
  marks: ILXMDurationMarkLayout[],
  rests: ILXMRestLayout[],
  strings: ILXMStringLineLayout[],
): ILXMTupletLayout[] => {
  const byBeat = new Map(beats.map((beat) => [beat.id, beat]));
  // 标注带位于实际节奏轮廓之下，不能把字体行框当作符尾墨迹下缘。
  const lowest = getRhythmBottom(strings, beams, marks, rests);
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
