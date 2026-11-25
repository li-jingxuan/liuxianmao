import type { ILXMRepeatEndingSegmentLayout } from "../layout/layout-types";
import { SCORE_TEXT_FONT } from "./constants";
import type { ScorePrimitive } from "./scene-types";

/** 复用相同括线几何导出、打印和绘制。跨行续段不绘制起始竖线。 */
export function repeatEndingPrimitives(segment: ILXMRepeatEndingSegmentLayout): ScorePrimitive[] {
  const { x, y, width } = segment.bounds;
  const right = x + width;
  const lineY = y + 2;
  const stroke = { stroke: "#1d2025", strokeWidth: 0.9, repeatEndingId: segment.id };
  const items: ScorePrimitive[] = [{ kind: "line", x1: x, y1: lineY, x2: right, y2: lineY, ...stroke }];
  if (segment.starts) items.push({ kind: "line", x1: x, y1: lineY, x2: x, y2: y + 10, ...stroke });
  if (segment.ends) items.push({ kind: "line", x1: right, y1: lineY, x2: right, y2: y + 10, ...stroke });
  items.push({
    kind: "text", text: segment.label, x: x + 4, y: y + 13, fontSize: 10, fontFamily: SCORE_TEXT_FONT,
    fontWeight: 400, textAnchor: "start", fill: "#1d2025", repeatEndingId: segment.id,
  });
  return items;
}
