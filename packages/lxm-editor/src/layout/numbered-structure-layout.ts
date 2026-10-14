import type { ILXMTrack } from "../core/types";
import type { ILXMSystemLayout, ILXMBarlineLayout } from "./layout-types";
import type { NumberedLayout } from "./numbered-notation-layout";
import type { NumberedMarkLayout } from "./numbered-mark-layout";
import { type ILXMMusicTextMetrics } from "./music-text-metrics";
/** 结构语义和横坐标沿用 TAB 投影，竖线仅覆盖简谱行，不穿过歌词。 */
export const layoutNumberedStructure = (
  _track: ILXMTrack,
  system: ILXMSystemLayout,
  frames: NumberedLayout[],
  _metrics?: ILXMMusicTextMetrics,
): NumberedMarkLayout[] => {
  const top =
    Math.min(
      -12,
      ...frames.flatMap((n) =>
        n.labels
          .filter((g) => g.fontFamily !== "Bravura")
          .map((g) => g.bounds.y),
      ),
    ) - 2;
  const bottom =
    Math.max(8, ...frames.map((n) => n.bounds.y + n.bounds.height)) + 2;
  const result: NumberedMarkLayout[] = [];
  const project = (barline: ILXMBarlineLayout, key: string) => {
    let dot = 0;
    for (const [i, p] of barline.parts.entries()) {
      result.push(
        p.kind === "line"
          ? {
              markId: `${key}-${i}`,
              type: "structure",
              path: {
                d: `M ${p.x} ${top} V ${bottom}`,
                strokeWidth: p.strokeWidth,
              },
              lines: [],
              dots: [],
              labels: [],
              bounds: {
                x: p.x - p.strokeWidth / 2,
                y: top,
                width: p.strokeWidth,
                height: bottom - top,
              },
            }
          : {
              markId: `${key}-${i}`,
              type: "structure",
              lines: [],
              dots: [
                {
                  cx: p.cx,
                  cy: (top + bottom) / 2 + (dot++ % 2 ? 3 : -3),
                  r: p.radius,
                },
              ],
              labels: [],
              bounds: {
                x: p.cx - p.radius,
                y: top,
                width: p.radius * 2,
                height: bottom - top,
              },
            },
      );
    }
  };
  system.measures.forEach((m) => {
    // 简谱只投影公共小节边界，不重复绘制拍号。
    project(m.barline, `${m.id}-numbered-barline`);
  });
  if (system.header.leadingBarline)
    project(system.header.leadingBarline, "numbered-leading");
  return result;
};
