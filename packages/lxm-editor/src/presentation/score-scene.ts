import {
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_DURATION_STEM_STROKE_WIDTH,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
} from "../layout/layout-constants";
import type { ILXMLayout, ILXMSystemLayout, ILXMBarlineLayout } from "../layout/layout-types";
import type { MusicTextGlyph } from "../layout/music-text/music-text-metrics";
import { SCORE_TEXT_FONT } from "./constants";
import type { ScorePrimitive, ScoreScene } from "./scene-types";

/** 显式样式图元由两个渲染器共享，不继承页面 CSS 或编辑焦点色。 */
export const textPrimitive = (
  text: string,
  x: number,
  y: number,
  fontSize: number,
  textAnchor: "start" | "middle" | "end" = "start",
  fontFamily = SCORE_TEXT_FONT,
  halo = 0,
): Extract<ScorePrimitive, { kind: "text" }> => ({
  kind: "text",
  text,
  x,
  y,
  fontSize,
  textAnchor,
  fontFamily,
  fontWeight: 400,
  fill: "#1d2025",
  ...(halo ? { stroke: "#fff", strokeWidth: halo * 2 } : {}),
});
const glyph = (g: MusicTextGlyph): ScorePrimitive => ({
  ...textPrimitive(g.text, g.x, g.y, g.fontSize, g.textAnchor, g.fontFamily),
  fontWeight: g.fontWeight,
  fill: g.fill ?? "#1d2025",
});
const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth = 1,
): ScorePrimitive => ({
  kind: "line",
  x1,
  y1,
  x2,
  y2,
  stroke: "#000",
  strokeWidth,
});
const barline = (bar: ILXMBarlineLayout): ScorePrimitive[] =>
  bar.parts.map((p) =>
    p.kind === "line"
      ? line(p.x, p.y1, p.x, p.y2, p.strokeWidth)
      : { kind: "circle", cx: p.cx, cy: p.cy, r: p.radius, fill: "#000" },
  );

/** 只投影核心几何，严格保留音乐层的绘制顺序。 */
const systemScene = (s: ILXMSystemLayout): ScorePrimitive[] => {
  const items: ScorePrimitive[] = [];
  // 简谱和谱行左边线也进入共享图元，保证编辑 SVG 与分页图片内容一致。
  items.push(
    ...(s.leftEdge ?? []).map((l) =>
      line(l.x1, l.y1, l.x2, l.y2, l.strokeWidth),
    ),
  );
  for (const mark of s.numberedMarks ?? []) {
    if (mark.path)
      items.push({
        kind: "path",
        d: mark.path.d,
        stroke: "#1d2025",
        strokeWidth: mark.path.strokeWidth,
        fill: "none",
        numberedMarkId: mark.markId,
      });
    items.push(
      ...mark.dots.map((d) => ({
        kind: "circle" as const,
        ...d,
        fill: "#1d2025",
        numberedMarkId: mark.markId,
      })),
      ...mark.labels.map((g) => ({ ...glyph(g), numberedMarkId: mark.markId })),
    );
  }
  for (const m of s.measures) {
    for (const notation of m.numberedNotation ?? []) {
      // 事件选择只关联数字和升降号，公共连梁、八度点及节奏图元保留原色。
      items.push(
        ...notation.labels.map((g) => ({
          ...glyph(g),
          numberedEventId: notation.eventId,
        })),
      );
      items.push(
        ...(notation.lines ?? [])
          .filter((l) => l.thickness > 0)
          .map((l) => line(l.x1, l.y, l.x2, l.y, l.thickness)),
      );
      items.push(
        ...(notation.rhythmDots ?? []).map((d) => ({
          kind: "circle" as const,
          ...d,
          fill: "#1d2025",
        })),
      );
      items.push(
        ...notation.dots.map((dot) => ({
          kind: "circle" as const,
          ...dot,
          fill: "#1d2025",
        })),
      );
    }
    for (const lyric of m.lyrics ?? []) items.push(glyph(lyric.label));
    for (const chord of m.chordSymbols ?? []) {
      items.push(glyph(chord.label));
      if (chord.diagram) {
        const d = chord.diagram;
        items.push(
          ...d.lines.map((l) => line(l.x1, l.y1, l.x2, l.y2, l.strokeWidth)),
          ...d.roundedRects.map((r) => ({
            kind: "rect" as const,
            ...r,
            fill: "#1d2025",
          })),
          ...d.circles.map((c) => ({
            kind: "circle" as const,
            ...c,
            fill: "#1d2025",
          })),
          ...d.texts.map(glyph),
        );
      }
    }
  }
  items.push(...s.header.strings.map((l) => line(l.x1, l.y1, l.x2, l.y2)));
  items.push(
    ...s.header.tabLetters.map((t) =>
      textPrimitive(
        t.text,
        t.x,
        t.y,
        t.fontSize,
        t.textAnchor,
        'Georgia, "Times New Roman", serif',
        1,
      ),
    ),
  );
  if (s.header.leadingBarline) items.push(...barline(s.header.leadingBarline));
  for (const m of s.measures) {
    items.push(...m.strings.map((l) => line(l.x1, l.y1, l.x2, l.y2)));
    if (m.timeSignature)
      for (const t of [m.timeSignature.numerator, m.timeSignature.denominator])
        items.push(
          textPrimitive(
            t.text,
            t.x,
            t.y,
            t.fontSize,
            t.textAnchor,
            'Georgia, "Times New Roman", serif',
          ),
        );
    items.push(
      ...m.restMarks.map((t) =>
        textPrimitive(t.glyph, t.x, t.y, 22, "middle", "Bravura, serif"),
      ),
    );
    items.push(
      ...m.notes.map((n) =>
        textPrimitive(
          n.fretText,
          n.x,
          n.y + LXM_FRET_TEXT_BASELINE_OFFSET_Y,
          LXM_FRET_TEXT_FONT_SIZE,
          "middle",
          SCORE_TEXT_FONT,
          LXM_FRET_TEXT_HALO_WIDTH,
        ),
      ),
    );
    items.push(...barline(m.barline));
    for (const mark of m.durationMarks) {
      if (mark.stemVisible)
        items.push(line(
          mark.stemX, mark.stemY1, mark.stemX, mark.stemY2,
          LXM_DURATION_STEM_STROKE_WIDTH,
        ));
      items.push(
        ...mark.sustainMarks.map((t) =>
          line(t.x1, t.y, t.x2, t.y, t.thickness),
        ),
      );
      if (mark.flag)
        items.push(
          textPrimitive(
            mark.flag.glyph,
            mark.flag.x,
            mark.flag.y,
            mark.flag.fontSize,
            "start",
            "Bravura, serif",
          ),
        );
      items.push(
        ...mark.dotAnchors.map((d) => ({
          kind: "circle" as const,
          cx: d.x,
          cy: d.y,
          r: 1,
          fill: "#000",
        })),
      );
    }
    for (const group of m.tuplets) {
      const t = group.label;
      items.push(textPrimitive(t.text, t.x, t.y, t.fontSize, t.textAnchor));
      items.push(
        ...(group.bracket?.lines ?? []).map((l) =>
          line(l.x1, l.y1, l.x2, l.y2, group.bracket!.strokeWidth),
        ),
      );
    }
    items.push(
      ...m.beamSegments.map((l) => line(l.x1, l.y, l.x2, l.y, l.thickness)),
    );
  }
  for (const t of s.techniques) {
    const primitives: ScorePrimitive[] = [];
    if (t.path) {
      primitives.push({
        kind: "path",
        d: t.path.d,
        fill: "none",
        stroke: "#1d2025",
        strokeWidth: t.path.strokeWidth,
        dash: t.path.dashArray,
        lineCap: "round",
      });
      if (t.path.arrowPoints)
        primitives.push({
          kind: "polygon",
          points: t.path.arrowPoints,
          fill: "#1d2025",
        });
    }
    if (t.arrowHead)
      primitives.push({
        kind: "polygon",
        points: t.arrowHead.points,
        fill: "#1d2025",
      });
    primitives.push(
      ...t.texts.map((g) =>
        textPrimitive(
          g.text,
          g.x,
          g.y,
          g.fontSize,
          g.textAnchor,
          SCORE_TEXT_FONT,
          t.type === "naturalHarmonic"
            ? LXM_FRET_TEXT_HALO_WIDTH
            : LXM_TECHNIQUE_TEXT_HALO_WIDTH,
        ),
      ),
    );
    items.push(
      ...primitives.map((p) => ({ ...p, techniqueId: t.techniqueId })),
    );
  }
  return items;
};
/**
 * 将最终布局投影为与渲染框架无关的音乐图元，供编辑 SVG、教学谱例与图片输出复用。
 * 坐标、分页和文字测量已由调用方准备；此处不访问 DOM、不重新排版、不改输入布局。
 * 图元保留领域对象 ID 供网站叠加选中态，但不携带编辑焦点颜色或命中交互层。
 * 数组顺序即绘制顺序，调整投影时需保持文字、线条及技巧的遮盖关系。
 */
export const buildScoreScene = (layout: ILXMLayout): ScoreScene => ({
  header: (layout.scoreHeader ?? []).map(glyph),
  systems: layout.systems.map((s) => ({
    index: s.index,
    items: systemScene(s),
  })),
});
