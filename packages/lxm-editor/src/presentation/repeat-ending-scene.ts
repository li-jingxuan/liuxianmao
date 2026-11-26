import type { ILXMRepeatEndingSegmentLayout } from "../layout/layout-types";
import { SCORE_TEXT_FONT } from "./constants";
import type { ScorePrimitive } from "./scene-types";

/** 编辑谱面、打印和图片导出共用房子图元。跨行时只在真实起止小节绘制竖端点。 */
export function repeatEndingPrimitives(segment: ILXMRepeatEndingSegmentLayout): ScorePrimitive[] {
  const { x, y, width } = segment.bounds;
  const right = x + width;
  const lineY = y + 2;
  // 竖端点从横线起量 8 个谱面单位。7px 标签的基线对齐端点底部，交互层仍按完整房子边界计算命中区。
  const endpointY = lineY + 8;
  const stroke = { stroke: "#1d2025", strokeWidth: 0.9, repeatEndingId: segment.id };
  const items: ScorePrimitive[] = [{ kind: "line", x1: x, y1: lineY, x2: right, y2: lineY, ...stroke }];
  if (segment.starts) items.push({ kind: "line", x1: x, y1: lineY, x2: x, y2: endpointY, ...stroke });
  if (segment.ends) items.push({ kind: "line", x1: right, y1: lineY, x2: right, y2: endpointY, ...stroke });
  // 遍次沿用小节号的灰色，弱化文字层级，同时保留括线的深色描边。
  items.push({
    kind: "text", text: segment.label, x: x + 4, y: endpointY, fontSize: 7, fontFamily: SCORE_TEXT_FONT,
    fontWeight: 400, textAnchor: "start", fill: "#7b8795", repeatEndingId: segment.id,
  });
  return items;
}
