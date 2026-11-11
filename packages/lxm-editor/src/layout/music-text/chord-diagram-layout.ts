import { getChordDiagramFretCount } from "../../core/chords/chord-diagram";
import type { ILXMChordDiagram } from "../../core/types";
import {
  musicTextGlyph,
  musicTextRequest,
  unionMusicBounds,
  type ILXMMusicTextMetrics,
  type MusicTextGlyph,
  type MusicTextRect,
} from "./music-text-metrics";
import {
  LXM_SCORE_CHORD_BARRE_DISPLAY_HEIGHT,
  LXM_SCORE_CHORD_DIAGRAM_SCALE,
} from "../layout-constants";

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
  const fretCount = getChordDiagramFretCount(diagram);
  const gridHeight = fretCount * 12;
  const stringX = (string: number) => (6 - string) * 9;
  const fretY = (fret: number) => (fret - diagram.startFret + 0.5) * 12;
  for (let i = 0; i < 6; i++) {
    lines.push({
      x1: i * 9,
      y1: 0,
      x2: i * 9,
      y2: gridHeight,
      strokeWidth: 0.8,
    });
  }
  // 六条弦线与品格边界分别生成，尾部不再保留未使用的两个品格。
  for (let i = 0; i <= fretCount; i++) {
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
    // 原图供侧栏编辑器复用，保留原有厚度；谱面厚度在缩放阶段单独处理。
    const barreHeight = 4 / 0.85;
    roundedRects.push({
      x: left - 4,
      y: y - barreHeight / 2,
      width: right - left + 8,
      height: barreHeight,
      rx: barreHeight / 2,
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
    { x: -1.5, y: -1.5, width: 48, height: gridHeight + 3 },
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

/** 谱面小字保留 5.5 号下限；原图字体不变，字形度量与命中外框同步。 */
export const scaleChordDiagram = (
  g: ChordDiagramLayout,
  scale: number,
): ChordDiagramLayout => {
  const bounds = (rect: MusicTextRect): MusicTextRect => ({
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });
  const texts = g.texts.map((t) => {
    const fontSize = Math.max(5.5, t.fontSize * scale);
    const textScale = fontSize / t.fontSize;
    // 度量缓存来自原字号；按比例换算墨迹，点击保护量仍保持最终坐标中的 2px。
    const inkY = (t.bounds.y - t.y + 2) * textScale;
    const inkHeight = (t.bounds.height - 4) * textScale;
    const y =
      scale < 1 && t.fill === "white"
        ? (t.y - 2.5) * scale - inkY - inkHeight / 2
        : t.y * scale;
    return {
      ...t,
      ...musicTextRequest(
        t.text,
        fontSize,
        t.textAnchor,
        t.fontWeight,
        t.fontFamily,
      ),
      x: t.x * scale,
      y,
      bounds: {
        x: t.x * scale + (t.bounds.x - t.x + 2) * textScale - 2,
        y: y + inkY - 2,
        width: (t.bounds.width - 4) * textScale + 4,
        height: inkHeight + 4,
      },
    };
  });
  const roundedRects = g.roundedRects.map((r) => {
    const height =
      scale < 1
        ? LXM_SCORE_CHORD_BARRE_DISPLAY_HEIGHT *
          (scale / LXM_SCORE_CHORD_DIAGRAM_SCALE)
        : r.height * scale;
    return {
      ...bounds(r),
      y: (r.y + r.height / 2) * scale - height / 2,
      height,
      rx: height / 2,
    };
  });
  // 3px 横按两端保持轻薄，数字处使用与单指同径的圆承载白色字形。
  const barreCircles =
    scale < 1
      ? g.roundedRects.map((r) => ({
          cx: (r.x + r.width / 2) * scale,
          cy: (r.y + r.height / 2) * scale,
          r: 4 * scale,
        }))
      : [];
  return {
    lines: g.lines.map((l) => ({
      ...l,
      x1: l.x1 * scale,
      x2: l.x2 * scale,
      y1: l.y1 * scale,
      y2: l.y2 * scale,
      strokeWidth: l.strokeWidth * scale,
    })),
    circles: [
      ...g.circles.map((c) => ({
        cx: c.cx * scale,
        cy: c.cy * scale,
        r: c.r * scale,
      })),
      ...barreCircles,
    ],
    roundedRects,
    texts,
    bounds: unionMusicBounds([
      bounds(g.bounds),
      ...roundedRects,
      ...barreCircles.map((c) => ({
        x: c.cx - c.r,
        y: c.cy - c.r,
        width: c.r * 2,
        height: c.r * 2,
      })),
      ...texts.map((t) => t.bounds),
    ]),
  };
};
