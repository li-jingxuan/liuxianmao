import type { ILXMMeasure, ILXMLyricVerse } from "../core/types";
import {
  layoutChordDiagram,
  translateChordDiagram,
  type ChordDiagramLayout,
} from "./chord-diagram-layout";
import {
  musicTextRequest,
  musicTextGlyph,
  unionMusicBounds,
  MUSIC_TEXT_GAP,
  type MusicTextGlyph,
  type MusicTextRect,
  type ILXMMusicTextMetrics,
} from "./music-text-metrics";

export interface LyricLayout {
  id: string;
  beatId: string;
  verse: ILXMLyricVerse;
  label: MusicTextGlyph;
  bounds: MusicTextRect;
}
export interface ChordSymbolLayout {
  id: string;
  beatId: string;
  label: MusicTextGlyph;
  diagram: ChordDiagramLayout | null;
  bounds: MusicTextRect;
  description: string;
}
/** 文本与图的原点均为所属 Beat；图先按真实 bbox 居中，再与名称组合。 */
export const createChordBlock = (
  symbol: ILXMMeasure["chordSymbols"][number],
  metrics?: ILXMMusicTextMetrics,
): ChordSymbolLayout => {
  const label = musicTextGlyph(
    musicTextRequest(symbol.chord.name, 13, "middle", 600),
    0,
    0,
    metrics,
  );
  const raw =
    symbol.display === "nameAndDiagram" && symbol.chord.diagram
      ? layoutChordDiagram(symbol.chord.diagram, metrics)
      : null;
  const diagram = raw
    ? translateChordDiagram(
        raw,
        -(raw.bounds.x + raw.bounds.width / 2),
        label.bounds.y + label.bounds.height + 5 - raw.bounds.y,
      )
    : null;
  return {
    id: symbol.id,
    beatId: symbol.beatId,
    label,
    diagram,
    bounds: unionMusicBounds([
      label.bounds,
      ...(diagram ? [diagram.bounds] : []),
    ]),
    description: `${symbol.chord.name}${symbol.chord.diagram ? "，" + symbol.chord.diagram.strings.map((s) => `${s.string}弦${s.fret === "x" ? "禁奏" : s.fret === 0 ? "空弦" : `${s.fret}品`}`).join("，") : ""}`,
  };
};
export const translateMusicGlyph = (
  g: MusicTextGlyph,
  dx: number,
  dy: number,
): MusicTextGlyph => ({
  ...g,
  x: g.x + dx,
  y: g.y + dy,
  bounds: { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy },
});
export const translateChordBlock = (
  b: ChordSymbolLayout,
  dx: number,
  dy: number,
): ChordSymbolLayout => ({
  ...b,
  label: translateMusicGlyph(b.label, dx, dy),
  diagram: b.diagram ? translateChordDiagram(b.diagram, dx, dy) : null,
  bounds: { ...b.bounds, x: b.bounds.x + dx, y: b.bounds.y + dy },
});
/** 一次计算每列最大投影；不同歌词段与和弦带复用横向空间。 */
export const getMusicTextExtents = (
  measure: ILXMMeasure,
  metrics?: ILXMMusicTextMetrics,
): Map<string, { left: number; right: number }> => {
  const result = new Map<string, { left: number; right: number }>();
  const add = (beatId: string, bounds: MusicTextRect) => {
    const existing = result.get(beatId) ?? { left: 0, right: 0 };
    result.set(beatId, {
      left: Math.max(existing.left, -bounds.x),
      right: Math.max(existing.right, bounds.x + bounds.width),
    });
  };
  for (const lyric of measure.lyrics)
    add(
      lyric.beatId,
      musicTextGlyph(musicTextRequest(lyric.text), 0, 0, metrics).bounds,
    );
  for (const symbol of measure.chordSymbols)
    add(symbol.beatId, createChordBlock(symbol, metrics).bounds);
  return result;
};
/** 首尾额外净空固定，不参与系统剩余宽度的拉伸。 */
export const musicTextInsets = (
  measure: ILXMMeasure,
  columns: { beatIds: string[]; minWidth: number }[],
  padding: number,
  leading: number,
  metrics?: ILXMMusicTextMetrics,
) => {
  const extents = getMusicTextExtents(measure, metrics);
  for (let i = 0; i < columns.length - 1; i++) {
    const right = extents.get(columns[i]!.beatIds[0]!)?.right ?? 0;
    const left = extents.get(columns[i + 1]!.beatIds[0]!)?.left ?? 0;
    if (right || left)
      columns[i]!.minWidth = Math.max(
        columns[i]!.minWidth,
        right + left + MUSIC_TEXT_GAP,
      );
  }
  const first = extents.get(columns[0]?.beatIds[0] ?? "");
  const last = extents.get(columns.at(-1)?.beatIds[0] ?? "");
  return {
    leftExtra: first
      ? Math.max(0, first.left + MUSIC_TEXT_GAP - padding - leading)
      : 0,
    tailExtra: last
      ? Math.max(
          0,
          last.right + MUSIC_TEXT_GAP - (columns.at(-1)!.minWidth + padding),
        )
      : 0,
  };
};
