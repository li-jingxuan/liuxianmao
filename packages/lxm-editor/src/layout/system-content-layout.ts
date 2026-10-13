import { layoutNumbered, translateNumbered } from "./numbered-notation-layout";
import { getMeasureContentBottom } from "./rhythm-bounds";
import type { ILXMTrack } from "../core/types";
import type { ILXMSystemLayout, ILXMMeasureLayout } from "./layout-types";
import {
  planTrackTechniques,
  translateMeasure,
  translateBarline,
} from "./technique-layout";
import {
  getFretTextBounds,
  translateTechniqueSegment,
} from "./technique-geometry";
import {
  LXM_TECHNIQUE_AREA_PADDING_TOP,
  LXM_CHORD_CONTENT_CLEARANCE_Y,
  LXM_CHORD_CONTENT_CLEARANCE_X,
} from "./layout-constants";
import {
  createChordBlock,
  chordDiagramGridOffset,
  translateChordBlock,
  translateMusicGlyph,
  type ChordSymbolLayout,
} from "./music-text-layout";
import {
  musicTextGlyph,
  musicTextRequest,
  unionMusicBounds,
  MUSIC_TEXT_LANE_GAP,
  MUSIC_LYRIC_VERSE_GAP,
  MUSIC_LYRIC_BOTTOM_GAP,
  type ILXMMusicTextMetrics,
} from "./music-text-metrics";

/** 各小节实际占位贡献约束，整行取最严格基线；远处标记不额外抬高和弦。 */
const resolveChordBaseline = (
  system: ILXMSystemLayout,
  blocks: readonly ChordSymbolLayout[],
): number => {
  if (!blocks.length) return system.y;
  const staffTop = system.measures[0]!.strings[0]!.y1;
  const obstacles = [
    ...system.measures.flatMap((measure) =>
      measure.notes.map(getFretTextBounds),
    ),
    ...system.techniques.map((technique) => technique.visualBounds),
  ].filter((bounds) => bounds.y < staffTop);
  return Math.min(
    ...blocks.map(({ bounds }) => {
      const obstacleTop = Math.min(
        staffTop,
        ...obstacles
          .filter(
            (obstacle) =>
              bounds.x <
                obstacle.x + obstacle.width + LXM_CHORD_CONTENT_CLEARANCE_X &&
              bounds.x + bounds.width + LXM_CHORD_CONTENT_CLEARANCE_X >
                obstacle.x,
          )
          .map((obstacle) => obstacle.y),
      );
      return (
        obstacleTop - LXM_CHORD_CONTENT_CLEARANCE_Y - (bounds.y + bounds.height)
      );
    }),
  );
};

/** 技巧投影后规划文本；所有正文只平移一次，最后才创建 hitIndex。 */
export const layoutSystemContent = (
  track: ILXMTrack,
  baseSystems: ILXMSystemLayout[],
  gap: number,
  metrics?: ILXMMusicTextMetrics,
  editing?: { measureId: string; kind: "lyric" | "numbered"; verse?: number },
): ILXMSystemLayout[] => {
  const planned = planTrackTechniques(track, baseSystems);
  const source = new Map(track.measures.map((m) => [m.id, m]));
  let nextTop = planned[0]?.y ?? 0;
  return planned.map((system) => {
    const techniqueTop = Math.min(
      ...system.techniques.map((t) => t.visualBounds.y),
    );
    const techniqueHeight = Math.max(
      0,
      system.y + LXM_TECHNIQUE_AREA_PADDING_TOP - techniqueTop,
    );
    // 简谱放在 TAB、节奏和技巧正文下方；先用零基线测量完整八度点边界。
    const bottom = Math.max(
      ...system.measures.map(getMeasureContentBottom),
      ...system.techniques.map((t) => t.visualBounds.y + t.visualBounds.height),
    );
    const numberedByMeasure = new Map(
      system.measures.map((m) => [
        m.id,
        source
          .get(m.id)!
          .beats.filter((b) => b.numberedNotation)
          .map((b) =>
            layoutNumbered(
              b.id,
              b.numberedNotation!.tokens,
              m.beats.find((x) => x.id === b.id)!.x,
              0,
              metrics,
            ),
          ),
      ]),
    );
    const active = system.measures.some((m) => m.id === editing?.measureId)
      ? editing
      : undefined;
    const rawNumbered = [...numberedByMeasure.values()].flat();
    const numberedDy = rawNumbered.length
      ? bottom +
        MUSIC_TEXT_LANE_GAP -
        Math.min(...rawNumbered.map((n) => n.bounds.y))
      : 0;
    for (const [id, numbered] of numberedByMeasure)
      numberedByMeasure.set(
        id,
        numbered.map((n) => translateNumbered(n, numberedDy)),
      );
    // 歌词从简谱最低圆点之后起排，无简谱时不预留额外一行。
    const paragraphBottom = Math.max(
      bottom +
        (active?.kind === "numbered" && !rawNumbered.length
          ? MUSIC_TEXT_LANE_GAP + 18
          : 0),
      ...[...numberedByMeasure.values()]
        .flat()
        .map((n) => n.bounds.y + n.bounds.height),
    );
    const symbols = system.measures.flatMap(
      (m) => source.get(m.id)!.chordSymbols,
    );
    const gridOffsetY = chordDiagramGridOffset(symbols, metrics);
    // 横坐标先确定，避让才能判断二维重叠；公共 Y 最后统一应用。
    const blocksByMeasure = new Map(
      system.measures.map((measure) => {
        const anchors = new Map(measure.beats.map((beat) => [beat.id, beat.x]));
        return [
          measure.id,
          source
            .get(measure.id)!
            .chordSymbols.map((symbol) =>
              translateChordBlock(
                createChordBlock(symbol, metrics, gridOffsetY),
                anchors.get(symbol.beatId)!,
                0,
              ),
            ),
        ] as const;
      }),
    );
    const chordBaseline = resolveChordBaseline(
      system,
      [...blocksByMeasure.values()].flat(),
    );
    const maxVerse = Math.max(
      active?.kind === "lyric" ? (active.verse ?? 1) : 0,
      ...system.measures.flatMap((m) =>
        source.get(m.id)!.lyrics.map((l) => l.verse),
      ),
    );
    const glyphs = system.measures.flatMap((m) =>
      source
        .get(m.id)!
        .lyrics.map((l) =>
          musicTextGlyph(musicTextRequest(l.text), 0, 0, metrics),
        ),
    );
    const rowAscent = Math.max(15, ...glyphs.map((g) => -g.bounds.y));
    const rowDescent = Math.max(
      6,
      ...glyphs.map((g) => g.bounds.y + g.bounds.height),
    );
    const rowHeight = rowAscent + rowDescent + MUSIC_LYRIC_VERSE_GAP;
    const lyricBaseline = paragraphBottom + MUSIC_TEXT_LANE_GAP + rowAscent;
    const measures: ILXMMeasureLayout[] = system.measures.map((measure) => {
      const domain = source.get(measure.id)!;
      const anchors = new Map(measure.beats.map((b) => [b.id, b.x]));
      const lyrics = domain.lyrics.map((l) => {
        const label = musicTextGlyph(
          musicTextRequest(l.text),
          anchors.get(l.beatId)!,
          lyricBaseline + (l.verse - 1) * rowHeight,
          metrics,
        );
        return {
          id: l.id,
          beatId: l.beatId,
          verse: l.verse,
          label,
          bounds: label.bounds,
        };
      });
      const chordSymbols = blocksByMeasure
        .get(measure.id)!
        .map((block) => translateChordBlock(block, 0, chordBaseline));
      return {
        ...measure,
        lyrics,
        chordSymbols,
        numberedNotation: numberedByMeasure.get(measure.id),
        visualBounds: unionMusicBounds([
          {
            x: measure.x,
            y: measure.y,
            width: measure.width,
            height: measure.height,
          },
          ...lyrics.map((l) => l.bounds),
          ...numberedByMeasure.get(measure.id)!.map((n) => n.bounds),
          ...chordSymbols.map((b) => b.bounds),
        ]),
      };
    });
    const musicTop = Math.min(
      system.y - techniqueHeight,
      ...measures.flatMap((m) =>
        (m.chordSymbols ?? []).map((b) => b.bounds.y - 2),
      ),
    );
    const finalBottom = maxVerse
      ? lyricBaseline +
        (maxVerse - 1) * rowHeight +
        rowDescent +
        MUSIC_LYRIC_BOTTOM_GAP
      : Math.max(
          paragraphBottom + (rawNumbered.length ? MUSIC_LYRIC_BOTTOM_GAP : 0),
          system.y + system.height,
        );
    // 段落标记仅保存在文档中，不再投影为标签或影响顶部占位。
    const originalTop = musicTop;
    const dy = nextTop - originalTop;
    // 空拍按相邻拍的中点划分；真实文字优先命中，避免长词被邻拍抢占。
    const musicTextCells: NonNullable<ILXMSystemLayout["musicTextCells"]> = [];
    const numberedTop = rawNumbered.length
      ? Math.min(
          ...[...numberedByMeasure.values()].flat().map((n) => n.bounds.y),
        )
      : bottom + MUSIC_TEXT_LANE_GAP;
    const numberedBottom = Math.max(
      numberedTop + 18,
      ...[...numberedByMeasure.values()]
        .flat()
        .map((n) => n.bounds.y + n.bounds.height),
    );
    for (const m of measures) {
      const addRow = (
        kind: "lyric" | "numbered",
        y: number,
        height: number,
        verse?: import("../core/types").ILXMLyricVerse,
      ) => {
        m.beats.forEach((b, i) => {
          const x = i ? (m.beats[i - 1]!.x + b.x) / 2 : m.x;
          const right =
            i + 1 < m.beats.length
              ? (b.x + m.beats[i + 1]!.x) / 2
              : m.x + m.width;
          const exists =
            kind === "numbered"
              ? m.numberedNotation?.some((n) => n.beatId === b.id)
              : m.lyrics?.some((l) => l.beatId === b.id && l.verse === verse);
          musicTextCells.push({
            x,
            y: y + dy,
            width: right - x,
            height,
            trackId: track.id,
            measureId: m.id,
            beatId: b.id,
            id: b.id,
            kind,
            verse,
            empty: !exists,
          });
        });
      };
      if (rawNumbered.length || active?.kind === "numbered")
        addRow("numbered", numberedTop, numberedBottom - numberedTop);
      for (let v = 1; v <= maxVerse; v++)
        addRow(
          "lyric",
          lyricBaseline + (v - 1) * rowHeight - rowAscent,
          rowAscent + rowDescent,
          v as import("../core/types").ILXMLyricVerse,
        );
    }
    const result: ILXMSystemLayout = {
      ...system,
      y: nextTop,
      height: finalBottom - originalTop,
      techniqueLaneCount: Math.max(
        0,
        ...system.techniques.map((t) => t.lane + 1),
      ),
      musicTextCells,
      header: {
        ...system.header,
        tabLetters: system.header.tabLetters.map((t) => ({
          ...t,
          y: t.y + dy,
        })),
        strings: system.header.strings.map((l) => ({
          ...l,
          y1: l.y1 + dy,
          y2: l.y2 + dy,
        })),
        leadingBarline: translateBarline(system.header.leadingBarline, dy),
      },
      measures: measures.map((m) => ({
        ...translateMeasure(m, dy),
        numberedNotation: m.numberedNotation?.map((n) =>
          translateNumbered(n, dy),
        ),
        lyrics: m.lyrics!.map((l) => ({
          ...l,
          label: translateMusicGlyph(l.label, 0, dy),
          bounds: { ...l.bounds, y: l.bounds.y + dy },
        })),
        chordSymbols: m.chordSymbols!.map((b) => translateChordBlock(b, 0, dy)),
        visualBounds: { ...m.visualBounds!, y: m.visualBounds!.y + dy },
      })),
      techniques: system.techniques.map((t) =>
        translateTechniqueSegment(t, dy),
      ),
      visualBounds: {
        x: system.x,
        y: nextTop,
        width: system.width,
        height: finalBottom - originalTop,
      },
    };
    // 收边只延伸到第一行实际歌词的上缘；同一行取最高字形边界，无歌词时对齐最下层横梁。
    // 行高仍保留排版净空，不能把歌词底部留白或其他标记的占位用于竖线端点。
    const lyrics = result.measures.flatMap((m) => m.lyrics ?? []);
    const firstLyricVerse = Math.min(...lyrics.map((l) => l.verse));
    const leftEdgeBottom = lyrics.length
      ? Math.min(
          ...lyrics
            .filter((l) => l.verse === firstLyricVerse)
            .map((l) => l.bounds.y),
        )
      : Math.max(
          ...result.measures.flatMap((m) => [
            ...m.strings.map((line) => Math.max(line.y1, line.y2)),
            ...m.beamSegments.map((beam) => beam.y),
          ]),
        );
    // 竖线位于谱行最左端；描边中心内缩半个线宽，避免 x=0 时被 SVG viewBox 裁切。
    result.leftEdge = [
      {
        x1: result.x + 0.5,
        x2: result.x + 0.5,
        y1: result.measures[0]!.strings[0]!.y1,
        y2: leftEdgeBottom,
        strokeWidth: 1,
      },
    ];
    nextTop += result.height + gap;
    return result;
  });
};
