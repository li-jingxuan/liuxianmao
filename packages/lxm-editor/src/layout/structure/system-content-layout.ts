import { buildNumberedIndex, createNumberedTrackRhythmContext } from "../../core/numbered/numbered-rhythm";
import { getVisibleMeasureRepeatTrack } from "../../core/document/measure-repeat";
import { planLyricPositions } from "../../core/lyrics/lyric-positions";
import {
  layoutNumberedInputSlots,
  numberedXAtTick,
} from "../music-text/numbered-input-layout";
import { layoutNumberedStructure } from "../music-text/numbered-structure-layout";
import {
  layoutNumberedMarks,
  translateNumberedMark,
} from "../music-text/numbered-mark-layout";
import { layoutNumberedRhythm } from "../music-text/numbered-rhythm-layout";
import { layoutNumbered, translateNumbered } from "../music-text/numbered-notation-layout";
import { getMeasureContentBottom } from "../rhythm/rhythm-bounds";
import type { ILXMTrack } from "../../core/types";
import type { getMusicTextRows } from "../../core/music-text/music-text-rows";
import type {
  ILXMSystemLayout,
  ILXMMeasureLayout,
  ILXMLayoutOptions,
  ILXMLayoutPurpose,
} from "../layout-types";
import { numberedLayoutProfile } from "../music-text/numbered-layout-profile";
import { planTrackTechniques } from "../techniques/technique-layout";
import { translateMeasure, translateBarline } from "../layout-translation";
import { layoutBarline } from "./barline-layout";
import { isJumpDestination, layoutJumpMarks } from "./jump-mark-layout";
import { layoutRepeatEndingSegments, REPEAT_ENDING_LANE_HEIGHT } from "./repeat-ending-layout";
import {
  getFretTextBounds,
  translateTechniqueSegment,
} from "../techniques/technique-geometry";
import {
  LXM_TECHNIQUE_AREA_PADDING_TOP,
  LXM_CHORD_CONTENT_CLEARANCE_Y,
  LXM_CHORD_CONTENT_CLEARANCE_X,
  LXM_NUMBERED_TEXT_FONT_SIZE,
} from "../layout-constants";
import {
  createChordBlock,
  chordDiagramGridOffset,
  translateChordBlock,
  translateMusicGlyph,
  type ChordSymbolLayout,
} from "../music-text/music-text-layout";
import {
  musicTextGlyph,
  musicTextInkBounds,
  musicTextRequest,
  unionMusicBounds,
  MUSIC_TEXT_LANE_GAP,
  MUSIC_LYRIC_VERSE_GAP,
  MUSIC_LYRIC_BOTTOM_GAP,
  MUSIC_LYRIC_FONT_SIZE,
  type ILXMMusicTextMetrics,
} from "../music-text/music-text-metrics";

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
  purpose: ILXMLayoutPurpose = "presentation",
  rows?: ReturnType<typeof getMusicTextRows>,
  placeholders?: ILXMLayoutOptions["paragraphPlaceholders"],
  numberedRhythm = createNumberedTrackRhythmContext(track),
  endingPreview?: ILXMLayoutOptions["repeatEndingPreview"],
  groupPreview?: ILXMLayoutOptions["repeatEndingGroupPreview"],
): ILXMSystemLayout[] => {
  const profile = numberedLayoutProfile(purpose);
  const visibleTrack = getVisibleMeasureRepeatTrack(track);
  const planned = planTrackTechniques(visibleTrack, baseSystems);
  const numberedIndex = buildNumberedIndex(visibleTrack, numberedRhythm);
  const source = new Map(visibleTrack.measures.map((m) => [m.id, m]));
  const repeatEndings = track.repeatEndingGroups?.flatMap(({ endings }) => endings) ?? [];
  const measureIndexes = new Map(track.measures.map(({ id }, index) => [id, index]));
  const draftEndings = groupPreview?.endings.map((ending, index) => ({
    ...ending, id: ending.id || `draft-ending-${index}`,
  })) ?? (endingPreview ? [endingPreview] : []);
  const previewStart = measureIndexes.get(groupPreview?.startMeasureId ?? "") ?? -1;
  const previewShared = measureIndexes.get(groupPreview?.sharedEndMeasureId ?? "") ?? -1;
  const previewEnd = measureIndexes.get(groupPreview?.endMeasureId ?? "") ?? -1;
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
          .numberedVoice.events.filter((e) => e.kind !== "gap")
          .map((b) => {
            const frame = layoutNumbered(
              b.id,
              b.items.map((i) => i.token),
              m.numberedSlots.find((x) => x.id === b.id)!.x,
              0,
              metrics,
              profile,
            );
            const labels = frame.labels.filter(
              (g) => g.fontFamily !== "Bravura",
            );
            frame.itemBounds = b.items.map((item, i) => ({
              itemId: item.id,
              bounds: labels[i]!.bounds,
            }));
            return frame;
          }),
      ]),
    );
    for (const m of system.measures) {
      if (m.measureRepeat) continue;
      numberedByMeasure.set(
        m.id,
        layoutNumberedRhythm(
          source.get(m.id)!,
          m,
          numberedByMeasure.get(m.id)!,
          numberedRhythm,
        ),
      );
    }
    const active = system.measures.some((m) => m.id === editing?.measureId)
      ? editing
      : undefined;
    const rawNumbered = [...numberedByMeasure.values()].flat();
    const showNumberedInput =
      purpose === "editing" && (rows?.numbered || active?.kind === "numbered" ||
        system.measures.some((m) => m.id === placeholders?.numberedMeasureId));
    const emptyBody = musicTextGlyph(
      musicTextRequest("0", LXM_NUMBERED_TEXT_FONT_SIZE), 0, 0, metrics,
    );
    const rawNumberedMarks = layoutNumberedMarks(
      visibleTrack,
      system,
      rawNumbered,
      metrics,
      numberedIndex,
      profile,
    );
    if (rawNumbered.length || rawNumberedMarks.length || showNumberedInput)
      rawNumberedMarks.push(
        ...layoutNumberedStructure(visibleTrack, system, rawNumbered, metrics),
      );
    const numberedDy =
      rawNumbered.length || rawNumberedMarks.length || showNumberedInput
        ? bottom +
          profile.staffGap -
          Math.min(
            ...rawNumbered.map((n) => n.bounds.y),
            ...rawNumberedMarks.map((n) => n.bounds.y),
            ...(rawNumbered.length ? [] : [emptyBody.bounds.y]),
          )
        : 0;
    for (const [id, numbered] of numberedByMeasure)
      numberedByMeasure.set(
        id,
        numbered.map((n) => translateNumbered(n, numberedDy)),
      );
    // 歌词从简谱最低圆点之后起排，无简谱时不预留额外一行。
    const paragraphBottom = Math.max(
      bottom,
      ...[...numberedByMeasure.values()]
        .flat()
        .map((n) => n.bounds.y + n.bounds.height),
      ...rawNumberedMarks.map((n) => n.bounds.y + n.bounds.height + numberedDy),
      ...(rawNumbered.length || !(rawNumberedMarks.length || showNumberedInput)
        ? []
        : [emptyBody.bounds.y + emptyBody.bounds.height + numberedDy]),
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
      rows?.lyricVerses ?? 0,
      active?.kind === "lyric" ? (active.verse ?? 1) : 0,
      system.measures.some((m) => m.id === placeholders?.lyric?.measureId)
        ? (placeholders?.lyric?.verse ?? 1)
        : 0,
      ...system.measures.flatMap((m) =>
        source.get(m.id)!.lyrics.map((l) => l.verse),
      ),
    );
    const glyphs = system.measures.flatMap((m) =>
      source
        .get(m.id)!
        .lyrics.map((l) =>
          musicTextGlyph(musicTextRequest(l.text, MUSIC_LYRIC_FONT_SIZE), 0, 0, metrics),
        ),
    );
    // 段间按实际墨迹排布，点击保护框的上下 2px 不再重复计入每段行距。
    const lyricInk = glyphs.map(musicTextInkBounds);
    const rowAscent = Math.max(MUSIC_LYRIC_FONT_SIZE, ...lyricInk.map((bounds) => -bounds.y));
    const rowDescent = Math.max(
      1,
      ...lyricInk.map((bounds) => bounds.y + bounds.height),
    );
    const rowHeight = rowAscent + rowDescent + MUSIC_LYRIC_VERSE_GAP;
    const lyricBaseline = paragraphBottom + MUSIC_TEXT_LANE_GAP + rowAscent;
    const measures: ILXMMeasureLayout[] = system.measures.map((measure) => {
      const domain = source.get(measure.id)!;
      const anchors = new Map(
        measure.numberedSlots.map((slot) => [slot.id, slot.x]),
      );
      const lyrics = domain.lyrics.map((l) => {
        const label = musicTextGlyph(
          musicTextRequest(l.text, MUSIC_LYRIC_FONT_SIZE),
          anchors.get(l.eventId)!,
          lyricBaseline + (l.verse - 1) * rowHeight,
          metrics,
        );
        return {
          id: l.id,
          eventId: l.eventId,
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
      };
    });
    // 起始记号可能局部抬高和弦图。先完成避让再算各小节实际范围和房子上层，
    // 否则换行分页与和弦点击可能仍使用水平基线时的旧坐标。
    const jumpBounds = layoutJumpMarks(system, measures, source);
    for (const measure of measures) {
      measure.visualBounds = unionMusicBounds([
        { x: measure.x, y: measure.y, width: measure.width, height: measure.height },
        ...measure.lyrics!.map((lyric) => lyric.bounds),
        ...measure.numberedNotation!.map((notation) => notation.bounds),
        ...measure.chordSymbols!.map((chord) => chord.bounds),
      ]);
    }
    const [firstMeasure] = measures;
    // 行首无反复线时，落点仍需对应一根真实的起始线。已有反复线直接复用。
    const leadingBarline = system.header.leadingBarline ?? (
      firstMeasure?.jumpMarks?.some((mark) => isJumpDestination(mark.kind))
        ? layoutBarline("single", firstMeasure.strings, system.header.staffX)
        : null
    );
    const musicTop = Math.min(
      system.y - techniqueHeight,
      jumpBounds?.y ?? Infinity,
      ...measures.flatMap((m) =>
        (m.chordSymbols ?? []).map((b) => b.bounds.y - 2),
      ),
    );
    // 反复括线在跳转记号和和弦上方另占一层。草稿单独排版，调整范围时仍能核对原括线。
    const endingTop = musicTop - REPEAT_ENDING_LANE_HEIGHT - 2;
    const endingSegments = layoutRepeatEndingSegments(system, repeatEndings, measureIndexes, endingTop);
    const previewTop = endingTop - (endingSegments.length ? REPEAT_ENDING_LANE_HEIGHT : 0);
    const endingPreviewSegments = layoutRepeatEndingSegments(system, draftEndings, measureIndexes, previewTop);
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
    const originalTop = endingPreviewSegments.length ? previewTop : endingSegments.length ? endingTop : musicTop;
    const dy = nextTop - originalTop;
    // 只投影可读的组边界。不完整草稿仍可显示有效房子的虚线括线，便于逐项修正。
    const groupPreviewBounds: NonNullable<ILXMSystemLayout["repeatEndingGroupPreview"]> =
      previewStart >= 0 && previewStart <= previewShared && previewShared < previewEnd
        ? system.measures.filter(({ index }) => index >= previewStart && index <= previewEnd).map((measure) => ({
          kind: measure.index <= previewShared ? "shared" : "ending",
          bounds: { x: measure.x, y: measure.strings[0]!.y1 + dy - 3, width: measure.width, height: 3 },
        })) : [];
    // 全部简谱事件参与中点划分，只有音符生成歌词入口；真实文字优先命中。
    const musicTextCells: NonNullable<ILXMSystemLayout["musicTextCells"]> = [];
    // 占位只使用数字正文带，不把高音点、减时线和上方连线当作输入框基线。
    const body =
      rawNumbered.flatMap((n) =>
        n.labels.filter((g) => g.fontFamily !== "Bravura"),
      )[0] ?? emptyBody;
    const numberedTop = body.bounds.y + numberedDy;
    const numberedHeight = Math.max(LXM_NUMBERED_TEXT_FONT_SIZE + 4, body.bounds.height);
    for (const m of maxVerse > 0 ? measures : []) {
      // 缩写小节的谱面交互只接收整节命中，歌词普通空位也要隐藏。
      if (m.measureRepeat) continue;
      const positions = planLyricPositions(source.get(m.id)!, numberedRhythm);
      const slots = [
        ...m.numberedSlots.map((slot) => ({
          ...slot,
          endTick: positions.find((position) => position.eventId === slot.id)
            ?.endTick,
        })),
        ...positions
          .filter((position) => !position.eventId)
          .map((position) => ({
            id: undefined,
            kind: "gap" as const,
            tick: position.tick,
            endTick: position.endTick,
            x: numberedXAtTick(m, position.tick),
          })),
      ].sort((a, b) => a.tick - b.tick);
      const addRow = (
        y: number,
        height: number,
        verse?: import("../../core/types").ILXMLyricVerse,
      ) => {
        slots.forEach((slot, i) => {
          if (slot.kind !== "notes" && slot.kind !== "gap") return;
          const x = i ? (slots[i - 1]!.x + slot.x) / 2 : m.x;
          const right =
            i + 1 < slots.length
              ? (slot.x + slots[i + 1]!.x) / 2
              : m.x + m.width;
          const exists =
            !!slot.id &&
            m.lyrics?.some((l) => l.eventId === slot.id && l.verse === verse);
          musicTextCells.push({
            x,
            y: y + dy,
            width: right - x,
            height,
            trackId: track.id,
            measureId: m.id,
            eventId: slot.id,
            tick: slot.tick,
            endTick: slot.endTick,
            anchorX: slot.x,
            id: slot.id ?? `time-${slot.tick}-${slot.endTick}`,
            kind: "lyric",
            verse,
            empty: !exists,
          });
        });
      };

      for (let v = 1; v <= maxVerse; v++)
        addRow(
          lyricBaseline + (v - 1) * rowHeight - rowAscent,
          rowAscent + rowDescent,
          v as import("../../core/types").ILXMLyricVerse,
        );
    }
    const result: ILXMSystemLayout = {
      ...system,
      ...(endingSegments.length && { repeatEndings: endingSegments.map((segment) => ({
        ...segment, bounds: { ...segment.bounds, y: segment.bounds.y + dy },
      })) }),
      ...(endingPreviewSegments.length && { repeatEndingPreview: endingPreviewSegments.map((segment) => ({
        ...segment, bounds: { ...segment.bounds, y: segment.bounds.y + dy },
      })) }),
      ...(groupPreviewBounds.length && { repeatEndingGroupPreview: groupPreviewBounds }),
      ...(rawNumbered.length || rawNumberedMarks.length || showNumberedInput
        ? {
            numberedRow: {
              y: numberedTop + dy,
              height: numberedHeight,
            },
          }
        : {}),
      numberedMarks: rawNumberedMarks.map((mark) =>
        translateNumberedMark(mark, numberedDy + dy),
      ),
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
        leadingBarline: translateBarline(leadingBarline, dy),
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
        ...(m.jumpMarks && {
          jumpMarks: m.jumpMarks.map((mark) => ({
            ...mark,
            y: mark.y + dy,
            bounds: { ...mark.bounds, y: mark.bounds.y + dy },
          })),
        }),
        ...(m.jumpMarkStartBarline && {
          jumpMarkStartBarline: translateBarline(m.jumpMarkStartBarline, dy)!,
        }),
        ...(m.numberPosition && {
          numberPosition: { ...m.numberPosition, y: m.numberPosition.y + dy },
        }),
        visualBounds: { ...m.visualBounds!, y: m.visualBounds!.y + dy },
      })),
      techniques: system.techniques.map((t) =>
        translateTechniqueSegment(t, dy),
      ),
      visualBounds: {
        x: system.x,
        y: nextTop,
        width: Math.max(system.width, jumpBounds ? jumpBounds.x + jumpBounds.width - system.x : 0),
        height: finalBottom - originalTop,
      },
    };
    result.measures = result.measures.map((m) => ({
      ...m,
      numberedInputSlots:
        purpose === "editing" && result.numberedRow && !m.measureRepeat
          ? layoutNumberedInputSlots(
              track.id,
              source.get(m.id)!,
              m,
              result.numberedRow,
              numberedRhythm,
            )
          : [],
    }));
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
