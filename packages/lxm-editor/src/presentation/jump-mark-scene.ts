import type { ILXMJumpMarkLayout } from "../layout/layout-types";
import type { ScorePrimitive } from "./scene-types";

/**
 * 落点的字形直接使用 11px 矢量笔画，避免 SVG、打印机和 Canvas 依赖额外音乐字体。
 * 小节末的回跳指令和 Fine 共用右对齐的单行文字，编辑、预览与打印使用同一图元。
 */
export const jumpMarkPrimitives = ({ id, kind, x, y, label }: ILXMJumpMarkLayout): ScorePrimitive[] => {
  const stroke = { jumpMarkId: id, stroke: "#1d2025", strokeWidth: 0.9, lineCap: "round" } as const;
  if (kind === "coda") {
    return [
      { kind: "circle", cx: x, cy: y, r: 3.4, fill: "none", ...stroke },
      { kind: "line", x1: x - 5.05, x2: x + 5.05, y1: y, y2: y, ...stroke },
      { kind: "line", x1: x, x2: x, y1: y - 5.05, y2: y + 5.05, ...stroke },
    ];
  }
  if (kind === "segno") {
    const fill = { jumpMarkId: id, fill: "#1d2025" };
    return [
      {
        kind: "path",
        d: `M ${x + 2.8} ${y - 3.4}` +
          ` C ${x + 1.8} ${y - 5.7} ${x - 3.2} ${y - 5.3} ${x - 2.7} ${y - 2.4}` +
          ` C ${x - 2.5} ${y - 0.9} ${x + 1.6} ${y + 0.4} ${x + 2.4} ${y + 1.9}` +
          ` C ${x + 4.1} ${y + 4.9} ${x - 1.6} ${y + 5.8} ${x - 2.7} ${y + 3.6}`,
        fill: "none",
        ...stroke,
      },
      { kind: "line", x1: x - 4.7, x2: x + 4.7, y1: y + 4.5, y2: y - 4.5, ...stroke },
      { kind: "circle", cx: x - 4.2, cy: y - 2.8, r: 0.8, ...fill },
      { kind: "circle", cx: x + 4.2, cy: y + 2.8, r: 0.8, ...fill },
    ];
  }
  return [{
    kind: "text",
    text: label,
    x,
    y,
    fontSize: 11,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 400,
    fontStyle: "italic",
    textAnchor: "end",
    fill: "#1d2025",
    jumpMarkId: id,
  }];
};
