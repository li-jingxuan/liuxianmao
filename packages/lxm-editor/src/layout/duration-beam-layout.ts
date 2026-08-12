/**
 *
 */

import {
  ILXMBeamSegmentLayout,
  ILXMBeatLayout,
  ILXMDurationMarkLayout,
  ILXMNoteLayout,
  ILXMStringLineLayout,
} from "./layout-types";
import { arraySortByKey } from "./layout-helpers";
import {
  ILXMBeat,
  ILXMMeasure,
  ILXMRhythm,
  ILXMRhythmBase,
} from "../core/types";
import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
  getTimeSignatureBeatGroupTicks,
} from "../core/rhythm";
import {
  LXM_DURATION_FLAG_FONT_SIZE,
  LXM_DURATION_FLAG_OFFSET_X,
  LXM_DURATION_FLAG_OFFSET_Y,
  LXM_DURATION_DOT_CLEARANCE_Y,
  LXM_DURATION_HEAD_FONT_SIZE,
  LXM_DURATION_HEAD_OFFSET_Y,
  LXM_DURATION_STEM_LENGTH,
  LXM_DURATION_STEM_NOTE_GAP,
  LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING,
  LXM_DURATION_SUSTAIN_MIN_WIDTH,
  LXM_DURATION_SUSTAIN_OFFSET_Y,
  LXM_DURATION_SUSTAIN_THICKNESS,
  LXM_DURATION_SUSTAIN_WIDTH,
} from "./layout-constants";

interface ILXMDurationBeamLayoutResult {
  beamSegments: ILXMBeamSegmentLayout[];
  durationMarks: ILXMDurationMarkLayout[];
}

// 每一个时值所需的连梁数量
const LXM_RHYTHM_BEAM_LEVEL: Record<ILXMRhythmBase, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtySecond: 3,
};

/**
 * TAB 数字不能像五线谱音符头一样直接切换空心/实心，因此在第六弦下方的独立
 * rhythm lane 使用 Bravura/SMuFL 节奏头表达基础时值。四分及更短时值共享实心头，
 * 再由 beamLevel 对应的连梁或旗帜继续区分。
 */
const LXM_DURATION_HEAD_GLYPH: Record<ILXMRhythmBase, string> = {
  whole: "\uE0A2",
  half: "\uE0A3",
  quarter: "\uE0A4",
  eighth: "\uE0A4",
  sixteenth: "\uE0A4",
  thirtySecond: "\uE0A4",
};

/** 一个基础时值包含的四分音符单位数；短于四分时不生成延续占位线。 */
const LXM_RHYTHM_QUARTER_UNIT_COUNT: Record<ILXMRhythmBase, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0,
  sixteenth: 0,
  thirtySecond: 0,
};

/** 孤立短时值使用一个已经包含完整层数的向下 composite flag。 */
const LXM_DURATION_FLAG_GLYPH: Partial<Record<ILXMRhythmBase, string>> = {
  eighth: "\uE241",
  sixteenth: "\uE243",
  thirtySecond: "\uE245",
};

// 多层连梁之间的纵向距离。
export const LXM_DURATION_BEAM_LEVEL_GAP = 5;
// 连梁横条厚度。
export const LXM_DURATION_BEAM_THICKNESS = 3;
// partial beam 的默认短横线长度。
// TODO 这里明显不对，要根据时值和dots来计算
export const LXM_DURATION_PARTIAL_BEAM_LENGTH = 12;
// 第一个附点相对符干的水平偏移，以及多附点之间的水平间距。
export const LXM_DURATION_DOT_OFFSET_X = 2.5;
export const LXM_DURATION_DOT_GAP_X = 2.5;

/**
 * 1. 需要计算当前 timeSignature 下的 tick 总和（4/4拍 = 960tick）
 * 2. 需要计算当前 beat 的时值tick，判断是否是拍组边界断开的
 * 3. 进行连梁分组：
 *  - 小节 = 拍组总和
 *  - 连梁和拍组关联
 * 4. 共享连梁：同拍组同一层级 level 共享连梁
 * 5. 部分连梁：
 *  - 附点：
 *  - 不同时值：比如 4/8 + 4/16 + 4/16，需要生成一个共享连梁和一个部分连梁
 */
export const groupContiguousMarks = (
  measure: ILXMMeasure,
  markByBeatId: Map<string, ILXMDurationMarkLayout>,
): ILXMDurationMarkLayout[][] => {
  const groups: ILXMDurationMarkLayout[][] = [];
  /*
   * 拍组和小节容量是两个不同概念。3/4 与 6/8 都有 2880 tick 的小节容量，但
   * 3/4 应按三个四分音符分组，6/8 应按两个附点四分音符分组。这里消费显式数组
   * 并累计成绝对边界，因此未来即使加入 5/8 的 2+3 非等长拍组也不必改算法。
   *
   * 对 schema 可加载、但没有专业 profile 的拍号使用“整小节单组”保守降级；
   * 宁可少断一次连梁，也不能凭分子分母猜测不对称拍子的音乐重音。
   */
  const beatGroupTicks = getTimeSignatureBeatGroupTicks(
    measure.timeSignature,
  ) ?? [getMeasureCapacityTicks(measure.timeSignature)];
  let accumulatedTicks = 0;
  const beatGroupEndTicks = beatGroupTicks.map((ticks) => {
    accumulatedTicks += ticks;
    return accumulatedTicks;
  });
  const getGroupIndex = (tick: number): number => {
    const index = beatGroupEndTicks.findIndex((endTick) => tick < endTick);
    return index < 0 ? beatGroupEndTicks.length : index;
  };

  let currentGroup: ILXMDurationMarkLayout[] = [];
  let previousBeatEndTick: number | null = null;
  let previousBeatEndGroupIndex: number | null = null;
  let previousBeatCrossesGroupBoundary = false;

  /** 刷新当前连梁分组 */
  const flushCurrentGroup = () => {
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  };

  for (const beat of arraySortByKey<ILXMBeat>(measure.beats, "tick")) {
    const mark = markByBeatId.get(beat.id);
    const rhythmTicksResult = calculateRhythmTicks(beat.rhythm);

    if (!rhythmTicksResult.ok) {
      throw new Error(`rhythm tick is invalid! beat id: ${beat.id}`);
    }

    // 当前 beat 开始 tick
    const beatStartTick = beat.tick;
    // 当前 beat 结束 tick
    const beatEndTick = beat.tick + rhythmTicksResult.ticks;
    // 当前 beat 开始拍组索引
    const beatStartGroupIndex = getGroupIndex(beatStartTick);
    // 当前 beat 结束拍组索引
    const beatEndGroupIndex = getGroupIndex(beatEndTick - 1);
    // 当前 beat 是否跨拍组边界
    const beatCrossesGroupBoundary = beatStartGroupIndex !== beatEndGroupIndex;

    if (!mark || mark.beamLevel <= 0) {
      flushCurrentGroup();
      previousBeatEndTick = null;
      previousBeatEndGroupIndex = null;
      previousBeatCrossesGroupBoundary = false;
      continue;
    }

    /**
     * 连梁分组同时受“是否连续”和“是否同拍组”约束：
     * - 中间有空隙或长时值时断开；
     * - 上一个 beat 已经跨过拍组边界时断开；
     * - 当前 beat 起点已经进入新的拍组时断开。
     */
    if (
      previousBeatEndTick !== null &&
      (previousBeatCrossesGroupBoundary ||
        previousBeatEndTick !== beatStartTick ||
        previousBeatEndGroupIndex !== beatStartGroupIndex)
    ) {
      flushCurrentGroup();
    }

    currentGroup.push(mark);
    previousBeatEndTick = beatEndTick;
    previousBeatEndGroupIndex = beatEndGroupIndex;
    previousBeatCrossesGroupBoundary = beatCrossesGroupBoundary;
  }

  flushCurrentGroup();

  return groups;
};

/**
 * 布局单个连梁分组内的横梁段落。
 *
 * 1. 按 level 逐层扫描，而不是只比较相邻 beat 的 beamLevel。
 * 2. 同一 level 中连续命中的 mark 数量大于等于 2 时生成共享连梁。
 * 3. 同一 level 中只有单个 mark 命中时，生成指向同组相邻 beat 的 partial beam。
 * 4. 连梁 Y 坐标使用 baseY - ((level - 1) * LXM_DURATION_BEAM_LEVEL_GAP)。
 * 5. 附点 beat 在 level > 1 时不参与共享连梁，只作为 partial beam 候选。
 */
export const layoutBeamSegments = (
  group: ILXMDurationMarkLayout[],
  dotCountByBeatId: Map<string, number> = new Map(),
): ILXMBeamSegmentLayout[] => {
  const beamSegments: ILXMBeamSegmentLayout[] = [];
  // 最大连梁层级
  const maxBeamLevel = Math.max(0, ...group.map((mark) => mark.beamLevel));

  // 按 level 逐层按顺序扫描
  for (let level = 1; level <= maxBeamLevel; level += 1) {
    let levelMarks: ILXMDurationMarkLayout[] = [];

    /** 根据当前 level 的连续命中区段生成 shared 或 partial beam。 */
    const flushLevelMarks = () => {
      // 如果连续命中 mark 数量大于等于 2 时，生成共享连梁
      if (levelMarks.length >= 2) {
        const firstMark = levelMarks[0]!;
        const lastMark = levelMarks[levelMarks.length - 1]!;

        beamSegments.push({
          kind: "shared",
          measureId: firstMark.measureId,
          beatIds: levelMarks.map((mark) => mark.beatId),
          level,
          x1: firstMark.stemX,
          x2: lastMark.stemX,
          y: firstMark.beamY - (level - 1) * LXM_DURATION_BEAM_LEVEL_GAP,
          thickness: LXM_DURATION_BEAM_THICKNESS,
        });
      } else if (levelMarks.length === 1) {
        const mark = levelMarks[0]!;
        const markIndex = group.findIndex(
          (item) => item.beatId === mark.beatId,
        );
        const hasLeftNeighbor = markIndex > 0;
        const hasRightNeighbor = markIndex >= 0 && markIndex < group.length - 1;

        if (hasLeftNeighbor || hasRightNeighbor) {
          const direction = hasLeftNeighbor ? "left" : "right";
          const x1 =
            direction === "left"
              ? mark.stemX - LXM_DURATION_PARTIAL_BEAM_LENGTH
              : mark.stemX;
          const x2 =
            direction === "left"
              ? mark.stemX
              : mark.stemX + LXM_DURATION_PARTIAL_BEAM_LENGTH;

          beamSegments.push({
            kind: "partial",
            measureId: mark.measureId,
            beatIds: [mark.beatId],
            level,
            direction,
            x1,
            x2,
            y: mark.beamY - (level - 1) * LXM_DURATION_BEAM_LEVEL_GAP,
            thickness: LXM_DURATION_BEAM_THICKNESS,
          });
        }
      }

      levelMarks = [];
    };

    for (const mark of group) {
      const dotCount = dotCountByBeatId.get(mark.beatId) ?? 0;
      const canJoinCurrentLevel = mark.beamLevel >= level;
      // 当前 level > 1并且有附点, 就需要打断当前连梁
      const shouldBreakSharedByDot = level > 1 && dotCount > 0;

      // 当前 level 连梁已经处理完，或者当前 level 连梁需要打断
      if (!canJoinCurrentLevel || shouldBreakSharedByDot) {
        flushLevelMarks();

        if (canJoinCurrentLevel && shouldBreakSharedByDot) {
          levelMarks.push(mark);
          flushLevelMarks();
        }

        continue;
      }

      levelMarks.push(mark);
    }

    flushLevelMarks();
  }

  return beamSegments;
};

/**
 * 根据 rhythm lane 最高图形生成附点中心坐标。
 *
 * 有连梁时以最高层连梁为基准，无连梁时以 sustain lane 为基准。这样附点既不
 * 与隐藏的节奏头绑定，也不会和旗帜、连梁或长时值占位线重叠。
 */
const buildDurationDotAnchors = (
  stemX: number,
  beamY: number,
  beamLevel: number,
  rhythm: ILXMRhythm,
) => {
  const topRhythmY =
    beamLevel > 0
      ? beamY - (beamLevel - 1) * LXM_DURATION_BEAM_LEVEL_GAP
      : beamY;

  return Array.from({ length: rhythm.dots }, (_, index) => ({
    x: stemX + LXM_DURATION_DOT_OFFSET_X + index * LXM_DURATION_DOT_GAP_X,
    y: topRhythmY - LXM_DURATION_DOT_CLEARANCE_Y,
  }));
};

/**
 * 把长时值的 beat slot 等分为四分音符单位，并在起音后的每个单位中央放置
 * 一条短横线。线段宽度会受单元边界约束，因此不会越出当前 beat slot。
 */
const buildDurationSustainMarks = (
  beatLayout: ILXMBeatLayout,
  rhythmBase: ILXMRhythmBase,
  staffCenterY: number,
) => {
  const totalQuarterUnits = LXM_RHYTHM_QUARTER_UNIT_COUNT[rhythmBase];
  if (totalQuarterUnits <= 1) return [];

  const unitWidth = beatLayout.width / totalQuarterUnits;
  const availableWidth =
    unitWidth - LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING * 2;

  if (availableWidth < LXM_DURATION_SUSTAIN_MIN_WIDTH) {
    throw new Error(
      `时值占位单元宽度不足：beatId=${beatLayout.id}, availableWidth=${availableWidth}`,
    );
  }

  const lineWidth = Math.min(LXM_DURATION_SUSTAIN_WIDTH, availableWidth);

  return Array.from({ length: totalQuarterUnits - 1 }, (_, index) => {
    const unitIndex = index + 1;
    const unitCenterX = beatLayout.x + unitWidth * (unitIndex + 0.5);

    return {
      unitIndex,
      x1: unitCenterX - lineWidth / 2,
      x2: unitCenterX + lineWidth / 2,
      // 长时值占位线位于第一弦与第六弦之间的视觉中线。偏移常量只用于
      // 浏览器像素级校准，不能再把占位线带回下方的 rhythm lane。
      y: staffCenterY + LXM_DURATION_SUSTAIN_OFFSET_Y,
      thickness: LXM_DURATION_SUSTAIN_THICKNESS,
    };
  });
};

/** 构建节奏头、符干、附点和连梁层级所共享的基础 mark。 */
export const buildDurationMark = (
  measureId: string,
  headY: number,
  beamBaseY: number,
  staffCenterY: number,
  sourceBeats: ILXMBeat[],
  beatLayoutMap: Map<string, ILXMBeatLayout>,
  noteLayoutsByBeatId: Map<string, ILXMNoteLayout[]>,
): ILXMDurationMarkLayout[] =>
  sourceBeats.map((beat) => {
    const currentBeat = beatLayoutMap.get(beat.id);
    if (!currentBeat) {
      throw new Error(`beatLayoutMap is empty! beat id: ${beat.id}`);
    }
    const beatNotes = noteLayoutsByBeatId.get(beat.id);
    if (!beatNotes || beatNotes.length === 0) {
      throw new Error(
        `时值布局缺少音符坐标：measureId=${measureId}, beatId=${beat.id}`,
      );
    }
    const lowestNoteY = Math.max(...beatNotes.map((note) => note.y));

    // 计算 beamLevel
    const beamLevel = LXM_RHYTHM_BEAM_LEVEL[beat.rhythm.base];

    return {
      beatId: beat.id,
      measureId,
      head: {
        glyph: LXM_DURATION_HEAD_GLYPH[beat.rhythm.base],
        x: currentBeat.x,
        y: headY,
        fontSize: LXM_DURATION_HEAD_FONT_SIZE,
      },
      stemVisible: true,
      // stemX 与 TAB 音符共享时间锚点；stemY1 从和弦中画面最靠下的实际音符开始。
      stemX: currentBeat.x,
      stemY1: lowestNoteY + LXM_DURATION_STEM_NOTE_GAP,
      stemY2: beamBaseY,
      // 连梁的 Y 坐标（往上排列，这里与 符干 的 Y 坐标是相同的）
      beamY: beamBaseY,
      beamLevel: beamLevel,
      // 首个四分单位已经由符干表达，只为剩余单位建立占位数据。
      sustainMarks: buildDurationSustainMarks(
        currentBeat,
        beat.rhythm.base,
        staffCenterY,
      ),
      // 孤立 flag 在 beamSegments 完成后统一回填；此阶段只构建稳定的基础 mark。
      flag: null,
      dots: beat.rhythm.dots,
      dotAnchors: buildDurationDotAnchors(
        currentBeat.x,
        beamBaseY,
        beamLevel,
        beat.rhythm,
      ),
    };
  });

/** 布局完整时值符号：基础 mark、shared/partial beam，以及孤立 composite flag。 */
export const layoutDurationBeams = (
  measure: ILXMMeasure,
  beatLayouts: ILXMBeatLayout[],
  noteLayouts: ILXMNoteLayout[],
  strings: ILXMStringLineLayout[],
): ILXMDurationBeamLayoutResult => {
  // 删除某拍最后一个音符后，该 beat 仍保留在时间轴中，但不应生成 -Infinity
  // 坐标的符干；因此只为实际有音符的 beat 计算时值图形。
  const sourceBeats = arraySortByKey<ILXMBeat>(measure.beats, "tick").filter(
    // 休止符没有 TAB 音头，不能生成符干或连梁；空 notes beat 同样跳过。
    (beat) => beat.kind === "notes" && beat.notes.length > 0,
  );
  const beatLayoutMap = new Map(
    beatLayouts.map((layout) => [layout.id, layout]),
  );
  // 一次遍历建立 beat → notes 索引，避免 buildDurationMark 为每个 beat 重复扫描
  // 整个 noteLayouts 数组。索引保存最终 note.y，符干因此能连接真实渲染坐标。
  const noteLayoutsByBeatId = noteLayouts.reduce((map, note) => {
    const beatNotes = map.get(note.beatId) ?? [];
    beatNotes.push(note);
    map.set(note.beatId, beatNotes);
    return map;
  }, new Map<string, ILXMNoteLayout[]>());
  const firstStringLine = strings.find((line) => line.index === 1);
  const lastStringLine = strings.find((line) => line.index === 6);

  if (!firstStringLine || !lastStringLine) {
    throw new Error(`时值布局缺少边界弦线：measureId=${measure.id}`);
  }

  const headY = lastStringLine.y2 + LXM_DURATION_HEAD_OFFSET_Y;
  const beamBaseY = headY + LXM_DURATION_STEM_LENGTH;
  // 直接使用最终弦线布局坐标，确保 System 或谱面整体发生 Y 偏移后，占位线仍
  // 位于六线谱正中间。不能只使用高度差的一半，否则会丢失谱面的起始 Y。
  const staffCenterY = (firstStringLine.y1 + lastStringLine.y1) / 2;
  const durationMarks = buildDurationMark(
    measure.id,
    headY,
    beamBaseY,
    staffCenterY,
    sourceBeats,
    beatLayoutMap,
    noteLayoutsByBeatId,
  );
  const markByBeatId = new Map(
    durationMarks.map((mark) => [mark.beatId, mark]),
  );
  const beamGroups = groupContiguousMarks(measure, markByBeatId);

  const dotCountByBeatId = new Map(
    sourceBeats.map((beat) => [beat.id, beat.rhythm.dots]),
  );
  const beamSegments = beamGroups.flatMap((group) =>
    layoutBeamSegments(group, dotCountByBeatId),
  );
  const coveredBeatIds = new Set(
    beamSegments.flatMap((segment) => segment.beatIds),
  );
  const sourceBeatById = new Map(sourceBeats.map((beat) => [beat.id, beat]));
  const marksWithFlags = durationMarks.map((mark) => {
    const beat = sourceBeatById.get(mark.beatId);
    const flagGlyph = beat
      ? LXM_DURATION_FLAG_GLYPH[beat.rhythm.base]
      : undefined;

    // 当前 beam 算法会为有邻居的短时值生成 shared 或 partial segment；只有完全
    // 没有出现在任何 segment 中的短时值才是孤立音符。此处补 composite flag，
    // 避免与已经存在的连梁重复表达同一层时值。
    if (!flagGlyph || coveredBeatIds.has(mark.beatId)) return mark;

    return {
      ...mark,
      flag: {
        glyph: flagGlyph,
        x: mark.stemX + LXM_DURATION_FLAG_OFFSET_X,
        y: mark.stemY2 + LXM_DURATION_FLAG_OFFSET_Y,
        fontSize: LXM_DURATION_FLAG_FONT_SIZE,
      },
    };
  });

  return {
    beamSegments,
    durationMarks: marksWithFlags,
  };
};
