import {
  musicTextGlyph,
  musicTextRequest,
  unionMusicBounds,
  type ILXMMusicTextMetrics,
  type MusicTextGlyph,
  type MusicTextRect,
} from "./music-text-metrics";
import type { ILXMLayout } from "./layout-types";
export interface NumberedLayout {
  beatId: string;
  labels: MusicTextGlyph[];
  dots: { cx: number; cy: number; r: number }[];
  bounds: MusicTextRect;
}
/** 八度后缀投影为真实圆点，完整多音组横向度量只在核心计算。 */
export const layoutNumbered = (
  beatId: string,
  tokens: readonly string[],
  x: number,
  y: number,
  metrics?: ILXMMusicTextMetrics,
): NumberedLayout => {
  const raw = tokens.map((token) => {
    const suffix = token.match(/['.]+$/)?.[0] ?? "",
      body = token.slice(0, token.length - suffix.length);
    const glyph = musicTextGlyph(musicTextRequest(body, 14), 0, 0, metrics);
    return { suffix, glyph, width: Math.max(12, glyph.bounds.width) };
  });
  const width =
    raw.reduce((s, r) => s + r.width, 0) + Math.max(0, raw.length - 1) * 6;
  let left = x - width / 2;
  const labels: MusicTextGlyph[] = [],
    dots: NumberedLayout["dots"] = [];
  for (const r of raw) {
    const center = left + r.width / 2,
      g = musicTextGlyph(
        musicTextRequest(r.glyph.text, 14),
        center,
        y,
        metrics,
      );
    labels.push(g);
    for (let i = 0; i < r.suffix.length; i++)
      dots.push({
        cx: center,
        cy:
          r.suffix[0] === "'"
            ? g.bounds.y - 4 - i * 4
            : g.bounds.y + g.bounds.height + 4 + i * 4,
        r: 1.3,
      });
    left += r.width + 6;
  }
  return {
    beatId,
    labels,
    dots,
    bounds: unionMusicBounds([
      ...labels.map((g) => g.bounds),
      ...dots.map((d) => ({
        x: d.cx - d.r,
        y: d.cy - d.r,
        width: 2 * d.r,
        height: 2 * d.r,
      })),
    ]),
  };
};
export const translateNumbered = (
  n: NumberedLayout,
  dy: number,
): NumberedLayout => ({
  ...n,
  labels: n.labels.map((g) => ({
    ...g,
    y: g.y + dy,
    bounds: { ...g.bounds, y: g.bounds.y + dy },
  })),
  dots: n.dots.map((d) => ({ ...d, cy: d.cy + dy })),
  bounds: { ...n.bounds, y: n.bounds.y + dy },
});
/** 空内容只生成 overlay；不增添正式 lane，也不反馈到 system 高度或断行。 */
export const layoutParagraphFocus = (
  layout: ILXMLayout,
  target: {
    trackId: string;
    measureId: string;
    beatId: string;
    kind: "lyric" | "numbered";
    verse?: number;
  },
): MusicTextRect | null => {
  if (layout.trackId !== target.trackId) return null;
  for (const s of layout.systems) {
    const m = s.measures.find((m) => m.id === target.measureId),
      b = m?.beats.find((b) => b.id === target.beatId);
    if (!m || !b) continue;
    const existing = layout.hitIndex.musicTextBounds?.find(
      (r) =>
        r.measureId === m.id &&
        r.beatId === b.id &&
        r.kind === target.kind &&
        (target.kind !== "lyric" || r.verse === (target.verse ?? 1)),
    );
    if (existing)
      return {
        x: existing.x - 4,
        y: existing.y - 2,
        width: existing.width + 8,
        height: existing.height + 4,
      };
    const row =
      target.kind === "numbered"
        ? m.numberedNotation?.[0]?.bounds
        : s.measures
            .flatMap((m) => m.lyrics ?? [])
            .find((l) => l.verse === (target.verse ?? 1))?.bounds;
    const y =
      row?.y ??
      (target.kind === "numbered"
        ? Math.max(s.y, m.strings[0]!.y1 - 20)
        : Math.min(s.y + s.height - 20, m.strings.at(-1)!.y1 + 22));
    return {
      x: b.x - 12,
      y: Math.max(s.y, Math.min(y, s.y + s.height - 18)),
      width: 24,
      height: 18,
    };
  }
  return null;
};
