import type { Beat, Measure, RhythmValue, TimeSignature } from "../core/schema";
import {
  DURATION_DOT_X_OFFSET,
  DURATION_DOT_Y_OFFSET,
  DURATION_LANE_Y,
  DURATION_STEM_LENGTH,
  HIT_PADDING,
  STAFF_HEIGHT,
  STAFF_TOP,
  STRING_LINE_WIDTH,
  STRING_SPACING,
  SYSTEM_HEIGHT,
  TUPLET_MARGIN_TOP,
} from "./layout-constants";
import {
  buildBeamSegments,
  getDurationFlagCount,
  getDurationLevelY,
  getDurationNotehead,
  hasDurationStem,
} from "./duration-layout";
import { buildMeasureEditGrid } from "./edit-grid";
import {
  createBounds,
  getCapacityTicks,
  getRestY,
  getStringY,
} from "./layout-helpers";
import { getBeatSpacingSlot, layoutMeasureSpacing } from "./measure-spacing";
import type {
  LayoutHitIndex,
  LaidOutDurationMark,
  LaidOutMeasure,
  LaidOutTuplet,
} from "./layout-types";

/**
 * 单小节排版。
 *
 * 这个模块只关心“小节内部”如何从音乐时间转换为局部几何：
 * - beat / note / rest 的坐标
 * - 时值头、符干、连梁
 * - 连音括号
 * - 小节内命中区域
 *
 * 它不决定一行排几个小节，也不负责整首谱的分页和跨行继承，那些职责留在 `score-layout.ts`。
 */

/** Bravura SMuFL 休止符码点，只在 rest 渲染时配合 music-icon 字体类使用。 */
const REST_SYMBOLS: Record<RhythmValue["base"], string> = {
  whole: "\uE4E3",
  half: "\uE4E4",
  quarter: "\uE4E5",
  eighth: "\uE4E6",
  sixteenth: "\uE4E7",
  thirtySecond: "\uE4E8",
};

/**
 * 排版单个小节。
 *
 * 输入是已经确定好的小节 x/y/width 和有效拍号；输出包含该小节内所有拍点、
 * 音符、休止符、连音括号以及对应的命中区域。这个函数不决定一行放几个小节，
 * 只负责把一个小节内部的音乐时间转换为局部几何。
 */
export const layoutMeasure = (
  measure: Measure,
  context: {
    index: number;
    x: number;
    y: number;
    width: number;
    timeSignature: TimeSignature;
    showTimeSignature: boolean;
    hitIndex: LayoutHitIndex;
    editingRhythm?: RhythmValue;
  },
): LaidOutMeasure => {
  const capacityTicks = getCapacityTicks(context.timeSignature);
  const spacing = layoutMeasureSpacing(measure, {
    x: context.x,
    assignedWidth: context.width,
  });

  const beats = measure.beats.map((beat) => {
    const slot = getBeatSpacingSlot(spacing, beat);
    const x = slot.x;
    /**
     * 拍点宽度来自节奏列 spacing，而不是直接用 tick 比例换算。
     * 最小 10px 是命中测试和后续光标绘制的兜底，避免极短时值变成不可点击区域。
     */
    const width = Math.max(10, slot.width);
    /** 拍点命中区覆盖整组六线谱高度，而不是只覆盖视觉数字，方便空拍点击定位。 */
    context.hitIndex.beats[beat.id] = createBounds(
      x - HIT_PADDING,
      context.y + STAFF_TOP - HIT_PADDING,
      width + HIT_PADDING * 2,
      STAFF_HEIGHT + HIT_PADDING * 2,
    );
    return {
      id: beat.id,
      measureId: measure.id,
      kind: beat.kind,
      tick: beat.tick,
      x,
      width,
      rhythm: beat.rhythm,
    };
  });

  /** 音符坐标由 beat.tick 决定 x，由 string 决定 y；和弦中的多个音符因此天然垂直对齐。 */
  const notes = measure.beats.flatMap((beat) => {
    if (beat.kind !== "notes") return [];
    const x = getBeatSpacingSlot(spacing, beat).x;
    return beat.notes.map((note) => {
      const y = getStringY(context.y, note.string);
      context.hitIndex.notes[note.id] = createBounds(
        x - HIT_PADDING,
        y - HIT_PADDING,
        HIT_PADDING * 2,
        HIT_PADDING * 2,
      );
      return {
        id: note.id,
        beatId: beat.id,
        measureId: measure.id,
        fret: String(note.fret),
        string: note.string,
        x,
        y,
        ...(note.tie ? { tieTargetNoteId: note.tie.targetNoteId } : {}),
        ghost: Boolean(note.ghost),
      };
    });
  });

  /** 休止拍没有 string，使用小节中线 y，并保留 rhythm 供页面渲染附点。 */
  const rests = measure.beats.flatMap((beat) =>
    beat.kind === "rest"
      ? [
          {
            id: beat.id,
            measureId: measure.id,
            rhythm: beat.rhythm,
            symbol: REST_SYMBOLS[beat.rhythm.base],
            x: getBeatSpacingSlot(spacing, beat).x,
            y: getRestY(context.y),
          },
        ]
      : [],
  );

  /**
   * 音符时值属于 beat，不属于单个 note。
   * 因此这里按 notes beat 生成一份时值标记：和弦多音会共享同一时值头、符干与附点。
   */
  const durationMarks = measure.beats.flatMap((beat) => {
    if (beat.kind !== "notes") return [];
    if (beat.notes.length === 0) return [];

    const lastNodeString = [...beat.notes].sort((a, b) => b.string - a.string)[0]!;
    const x = getBeatSpacingSlot(spacing, beat).x;
    const flagCount = getDurationFlagCount(beat.rhythm.base);
    const hasStem = hasDurationStem(beat.rhythm.base);
    const nodeStringY = (lastNodeString.string - 1) * STRING_SPACING;
    const y = context.y + DURATION_LANE_Y + nodeStringY;

    // STAFF_TOP + (弦号 - 1) * 弦距
    // 例如弦号 1 为 54，弦号 2 为 65，弦号 3 为 76，以此类推。
    const stemBaseY = y + DURATION_STEM_LENGTH + STAFF_HEIGHT - nodeStringY;
    /**
     * 多层符尾/连梁需要更长的符干。
     * 当前实现先保留统一 stemBottomY，后续若接入 partial beam 或更复杂的 stem
     * 方向规则，可以在这里继续展开，而不影响页面层的数据消费方式。
     */
    const stemBottomY = stemBaseY;
    const flagAnchors = Array.from({ length: flagCount }, (_, index) => {
      const level = (index + 1) as 1 | 2 | 3;
      return {
        level,
        x,
        y: getDurationLevelY({ stemBaseY }, level),
      };
    });

    const dot = {
      x: x + DURATION_DOT_X_OFFSET,
      y: (
          flagCount > 0
            ? getDurationLevelY({ stemBaseY }, flagCount as 1 | 2 | 3)
            : stemBaseY
        ) - DURATION_DOT_Y_OFFSET
    };

    return [
      {
        beatId: beat.id,
        measureId: measure.id,
        x,
        y,
        base: beat.rhythm.base,
        dots: beat.rhythm.dots,
        notehead: getDurationNotehead(beat.rhythm.base),
        hasStem,
        stemX: x,
        stemTopY: y,
        stemBaseY,
        stemBottomY,
        flagCount,
        flagAnchors,
        dot,
      } satisfies LaidOutDurationMark,
    ];
  });

  const durationMarkByBeatId = new Map(
    durationMarks.map((mark) => [mark.beatId, mark] as const),
  );
  const beamSegments = buildBeamSegments(measure.beats, durationMarkByBeatId);
  const editGrid = buildMeasureEditGrid(
    measure,
    beats,
    context.editingRhythm,
  );

  /**
   * 连音括号需要覆盖从首拍开始到末拍结束的区间。
   * 因此右端点不是最后一个 beat 的 x，而是 lastBeat.tick + lastBeatTicks 对应的位置。
   */
  const beatById = new Map(measure.beats.map((beat) => [beat.id, beat]));
  const tuplets = measure.tuplets.flatMap((tuplet) => {
    if (tuplet.bracket === "hide") return [];
    const tupletBeats = tuplet.beatIds
      .map((beatId) => beatById.get(beatId))
      .filter((beat): beat is Beat => Boolean(beat));
    if (tupletBeats.length < 2) return [];

    const firstBeat = tupletBeats[0]!;
    const lastBeat = tupletBeats[tupletBeats.length - 1]!;
    const bracket: LaidOutTuplet["bracket"] =
      tuplet.bracket === "auto" ? "auto" : "show";
    const firstSlot = getBeatSpacingSlot(spacing, firstBeat);
    const lastSlot = getBeatSpacingSlot(spacing, lastBeat);

    return [
      {
        id: tuplet.id,
        measureId: measure.id,
        number: tuplet.actualNotes,
        x1: firstSlot.x,
        // 谱面视觉上先收束到末拍列起点，后续如果要覆盖整组时值宽度可改为 lastSlot.x + lastSlot.width。
        x2: lastSlot.x,
        y: context.y + STAFF_HEIGHT + TUPLET_MARGIN_TOP,
        bracket,
      } satisfies LaidOutTuplet,
    ];
  });

  /** 小节命中区使用整行小节高度，后续可以支持点击空白区域选中小节。 */
  context.hitIndex.measures[measure.id] = createBounds(
    context.x,
    context.y,
    context.width,
    SYSTEM_HEIGHT,
  );

  return {
    id: measure.id,
    index: context.index,
    number: context.index + 1,
    x: context.x,
    y: context.y,
    width: context.width,
    height: SYSTEM_HEIGHT,
    staffTop: STAFF_TOP,
    staffHeight: STAFF_HEIGHT + STRING_LINE_WIDTH,
    stringSpacing: STRING_SPACING,
    capacityTicks,
    timeSignature: context.timeSignature,
    showTimeSignature: context.showTimeSignature,
    barline: measure.barline,
    beats,
    notes,
    rests,
    durationMarks,
    beamSegments,
    tuplets,
    spacing,
    ...(editGrid ? { editGrid } : {}),
  };
};
