import { LXM_SCORE_CHORD_DIAGRAM_SCALE } from "./layout-constants";
import type { ILXMMeasure, ILXMLyricVerse } from "../core/types";
import {
  layoutChordDiagram,
  scaleChordDiagram,
  translateChordDiagram,
  type ChordDiagramLayout,
} from "./chord-diagram-layout";
import {
  musicTextRequest,
  musicTextGlyph,
  unionMusicBounds,
  MUSIC_TEXT_GAP,
  MUSIC_CHORD_NAME_FONT_SIZE,
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
/** 保留原参数契约，名称基线到网格顶线固定为 12，避免调用方版本不一致。 */
export const chordDiagramGridOffset = (
  _symbols: readonly ILXMMeasure["chordSymbols"][number][] = [],
  _metrics?: ILXMMusicTextMetrics,
): number => 12;

/** 网格左弦线对齐 Beat，名称居中于网格；只显示名称时仍以 Beat 为中心。 */
export const createChordBlock = (
  symbol: ILXMMeasure["chordSymbols"][number],
  metrics?: ILXMMusicTextMetrics,
  gridOffsetY?: number,
): ChordSymbolLayout => {
  const hasDiagram =
    symbol.display === "nameAndDiagram" && !!symbol.chord.diagram;
  const label = musicTextGlyph(
    musicTextRequest(
      symbol.chord.name,
      MUSIC_CHORD_NAME_FONT_SIZE,
      "middle",
      400,
    ),
    hasDiagram ? 22.5 * LXM_SCORE_CHORD_DIAGRAM_SCALE : 0,
    0,
    metrics,
  );
  const raw =
    symbol.display === "nameAndDiagram" && symbol.chord.diagram
      ? layoutChordDiagram(symbol.chord.diagram, metrics)
      : null;
  const diagram = raw
    ? translateChordDiagram(
        scaleChordDiagram(raw, LXM_SCORE_CHORD_DIAGRAM_SCALE),
        0,
        gridOffsetY ?? chordDiagramGridOffset([symbol], metrics),
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
  columns: { beatIds: string[]; minWidth: number; idealWidth: number }[],
  padding: number,
  leading: number,
  metrics?: ILXMMusicTextMetrics,
  reserveChordTail = true,
) => {
  // 歌词与和弦在不同高度，歌词间距不能把和弦宽度算进相邻空拍。
  const extents = getMusicTextExtents(
    { ...measure, chordSymbols: [] },
    metrics,
  );
  for (let i = 0; i < columns.length - 1; i++) {
    const right = extents.get(columns[i]!.beatIds[0]!)?.right ?? 0;
    const left = extents.get(columns[i + 1]!.beatIds[0]!)?.left ?? 0;
    if (right || left)
      columns[i]!.minWidth = Math.max(
        columns[i]!.minWidth,
        right + left + MUSIC_TEXT_GAP,
      );
  }
  columns.forEach((column) => {
    column.idealWidth = Math.max(column.idealWidth, column.minWidth);
  });
  const chords = columns.flatMap((column, index) =>
    measure.chordSymbols
      .filter((symbol) => column.beatIds.includes(symbol.beatId))
      .map((symbol) => ({
        index,
        bounds: createChordBlock(symbol, metrics).bounds,
      })),
  );
  // 两块和弦之间可以借用多拍的总空间，只在总跨度不足时扩宽前一列。
  for (let i = 0; i < chords.length; i++) {
    const current = chords[i]!;
    for (const previous of chords.slice(0, i)) {
      if (previous.index === current.index) continue;
      const span = columns
        .slice(previous.index, current.index)
        .reduce((sum, c) => sum + c.idealWidth, 0);
      const deficit =
        previous.bounds.x + previous.bounds.width + 4 - current.bounds.x - span;
      if (deficit > 0) {
        const column = columns[current.index - 1]!;
        column.minWidth = Math.max(
          column.minWidth,
          column.idealWidth + deficit,
        );
        column.idealWidth = column.minWidth;
      }
    }
  }
  const allExtents = getMusicTextExtents(measure, metrics);
  const first = allExtents.get(columns[0]?.beatIds[0] ?? "");
  const last = extents.get(columns.at(-1)?.beatIds[0] ?? "");
  // 行尾保护检查所有和弦，包括倒数几拍开始但越过末拍的长名称。
  const chordTail = reserveChordTail
    ? Math.max(
        0,
        ...chords.map(
          ({ index, bounds }) =>
            bounds.x +
            bounds.width +
            4 -
            padding -
            columns.slice(index).reduce((sum, c) => sum + c.idealWidth, 0),
        ),
      )
    : 0;
  // 非首拍的长名称也可能向左越界，按实际前缀跨度保留必要净空。
  const chordLeft = Math.max(
    0,
    ...chords.map(
      ({ index, bounds }) =>
        4 -
        padding -
        leading -
        bounds.x -
        columns.slice(0, index).reduce((sum, c) => sum + c.idealWidth, 0),
    ),
  );
  return {
    leftExtra: Math.max(
      chordLeft,
      first ? Math.max(0, first.left + MUSIC_TEXT_GAP - padding - leading) : 0,
    ),
    tailExtra: Math.max(
      chordTail,
      last
        ? Math.max(
            0,
            last.right + MUSIC_TEXT_GAP - (columns.at(-1)!.minWidth + padding),
          )
        : 0,
    ),
  };
};
