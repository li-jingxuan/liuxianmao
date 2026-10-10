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
    const bottom = Math.max(
      ...system.measures.map(getMeasureContentBottom),
      ...system.techniques.map((t) => t.visualBounds.y + t.visualBounds.height),
    );
    const maxVerse = Math.max(
      0,
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
    const lyricBaseline = bottom + MUSIC_TEXT_LANE_GAP + rowAscent;
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
        visualBounds: unionMusicBounds([
          {
            x: measure.x,
            y: measure.y,
            width: measure.width,
            height: measure.height,
          },
          ...lyrics.map((l) => l.bounds),
          ...chordSymbols.map((b) => b.bounds),
        ]),
      };
    });
    const originalTop = Math.min(
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
      : Math.max(bottom, system.y + system.height);
    const dy = nextTop - originalTop;
    const lyricVerseLabels = Array.from({ length: maxVerse }, (_, i) =>
      musicTextGlyph(
        musicTextRequest(`${i + 1}.`, 13, "start"),
        system.x + 2,
        lyricBaseline + i * rowHeight + dy,
        metrics,
      ),
    );
    const result: ILXMSystemLayout = {
      ...system,
      y: nextTop,
      height: finalBottom - originalTop,
      techniqueLaneCount: Math.max(
        0,
        ...system.techniques.map((t) => t.lane + 1),
      ),
      lyricVerseLabels,
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
    nextTop += result.height + gap;
    return result;
  });
};
