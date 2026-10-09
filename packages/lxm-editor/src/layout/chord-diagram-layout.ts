import type { ILXMChordDiagram } from "../core/types";
import {
  musicTextGlyph,
  musicTextRequest,
  unionMusicBounds,
  type ILXMMusicTextMetrics,
  type MusicTextGlyph,
  type MusicTextRect,
} from "./music-text-metrics";

export interface ChordDiagramLayout {
  lines: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    strokeWidth: number;
  }[];
  circles: { cx: number; cy: number; r: number }[];
  roundedRects: {
    x: number;
    y: number;
    width: number;
    height: number;
    rx: number;
  }[];
  texts: MusicTextGlyph[];
  bounds: MusicTextRect;
}
/** 六弦数据按 1→6 保存，指法图阅读方向按 6→1 绘制；预览复用同一几何。 */
export const layoutChordDiagram = (
  diagram: ILXMChordDiagram,
  metrics?: ILXMMusicTextMetrics,
): ChordDiagramLayout => {
  const lines: ChordDiagramLayout["lines"] = [];
  const circles: ChordDiagramLayout["circles"] = [];
  const roundedRects: ChordDiagramLayout["roundedRects"] = [];
  const texts: MusicTextGlyph[] = [];
  const stringX = (string: number) => (6 - string) * 9;
  const fretY = (fret: number) => (fret - diagram.startFret + 0.5) * 12;
  for (let i = 0; i < 6; i++) {
    lines.push({ x1: i * 9, y1: 0, x2: i * 9, y2: 60, strokeWidth: 0.8 });
    lines.push({
      x1: 0,
      y1: i * 12,
      x2: 45,
      y2: i * 12,
      strokeWidth: i === 0 && diagram.startFret === 1 ? 2.5 : 0.8,
    });
  }
  for (const b of diagram.barres) {
    const left = stringX(b.maxString),
      right = stringX(b.minString),
      y = fretY(b.fret);
    roundedRects.push({
      x: left - 4,
      y: y - 4,
      width: right - left + 8,
      height: 8,
      rx: 4,
    });
    texts.push({
      ...musicTextGlyph(
        musicTextRequest(String(b.finger), 7),
        (left + right) / 2,
        y + 2.5,
        metrics,
      ),
      fill: "white",
    });
  }
  for (const s of diagram.strings) {
    const x = stringX(s.string);
    if (s.fret === "x" || s.fret === 0)
      texts.push(
        musicTextGlyph(
          musicTextRequest(s.fret === "x" ? "×" : "○", 9),
          x,
          -5,
          metrics,
        ),
      );
    else if (
      !diagram.barres.some(
        (b) =>
          b.fret === s.fret &&
          s.string >= b.minString &&
          s.string <= b.maxString,
      )
    ) {
      const y = fretY(s.fret);
      circles.push({ cx: x, cy: y, r: 4 });
      if (s.finger)
        texts.push({
          ...musicTextGlyph(
            musicTextRequest(String(s.finger), 7),
            x,
            y + 2.5,
            metrics,
          ),
          fill: "white",
        });
    }
  }
  if (diagram.startFret > 1)
    texts.push(
      musicTextGlyph(
        musicTextRequest(String(diagram.startFret), 9, "end"),
        -7,
        10,
        metrics,
      ),
    );
  const bounds = unionMusicBounds([
    { x: -1.5, y: -1.5, width: 48, height: 63 },
    ...circles.map((c) => ({
      x: c.cx - c.r,
      y: c.cy - c.r,
      width: c.r * 2,
      height: c.r * 2,
    })),
    ...roundedRects,
    ...texts.map((t) => t.bounds),
  ]);
  return { lines, circles, roundedRects, texts, bounds };
};
/** 所有子图元及 bbox 同步平移，渲染层不重算坐标。 */
export const translateChordDiagram = (
  g: ChordDiagramLayout,
  dx: number,
  dy: number,
): ChordDiagramLayout => ({
  lines: g.lines.map((l) => ({
    ...l,
    x1: l.x1 + dx,
    x2: l.x2 + dx,
    y1: l.y1 + dy,
    y2: l.y2 + dy,
  })),
  circles: g.circles.map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })),
  roundedRects: g.roundedRects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
  texts: g.texts.map((t) => ({
    ...t,
    x: t.x + dx,
    y: t.y + dy,
    bounds: { ...t.bounds, x: t.bounds.x + dx, y: t.bounds.y + dy },
  })),
  bounds: { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy },
});
