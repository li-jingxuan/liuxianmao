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
import { arraySortByKey, getLastStringLine } from "./layout-helpers";
import {
  ILXMBeat,
  ILXMMeasure,
  ILXMRhythm,
  ILXMRhythmBase,
} from "../core/types";
import {
  calculateRhythmTicks,
  getCompleteBeatCapacityTicks,
} from "../core/rhythm";

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

// 连梁区域相对第六弦向下的顶部距离；符干终点会落在这条 baseline 上。
export const LXM_DURATION_BEAM_TOP_OFFSET_Y = 22;
// 多层连梁之间的纵向距离。
export const LXM_DURATION_BEAM_LEVEL_GAP = 5;
// 连梁横条厚度。
export const LXM_DURATION_BEAM_THICKNESS = 3;
// partial beam 的默认短横线长度。
// TODO 这里明显不对，要根据时值和dots来计算
export const LXM_DURATION_PARTIAL_BEAM_LENGTH = 12;
// 第一个附点相对符干的水平偏移，以及多附点之间的水平间距。
export const LXM_DURATION_DOT_OFFSET_X = 5;
export const LXM_DURATION_DOT_GAP_X = 5;
// 附点相对连梁基线的纵向偏移，避免与横梁重叠。
// export const LXM_DURATION_DOT_OFFSET_Y = 7;
// 时值符干和音符所在弦线之间的纵向间距，避免符干压住品位数字。
export const LXM_DURATION_STEM_NOTE_GAP = 6;

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
  // 完整拍组 tick 总和
  const beatGroupTicks = getCompleteBeatCapacityTicks(measure.timeSignature);

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
    const beatStartGroupIndex = Math.floor(beatStartTick / beatGroupTicks);
    // 当前 beat 结束拍组索引
    const beatEndGroupIndex = Math.floor((beatEndTick - 1) / beatGroupTicks);
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
 * 根据当前 beat 最低音符的锚点生成附点中心坐标。
 *
 * 附点应紧邻 TAB 品位数字，而不是落在符干终点或连梁附近；多附点仅沿 X 轴等距
 * 排列，保持相同的 Y 坐标。
 */
const buildDurationDotAnchors = (
  stemX: number,
  beamBaseY: number,
  rhythm: ILXMRhythm,
) => {
  return Array.from({ length: rhythm.dots }, (_, index) => ({
    x: stemX + LXM_DURATION_DOT_OFFSET_X + index * LXM_DURATION_DOT_GAP_X,
    // 附点以连梁基线为参考，避免与横梁重叠；附点应与品位数字处于同一视觉层，而不是跟随远离弦线的横梁基线。
    y: beamBaseY - (LXM_RHYTHM_BEAM_LEVEL[rhythm.base] * LXM_DURATION_BEAM_LEVEL_GAP) - 1
  }));
};

/** 构建时值符干布局 */
export const buildDurationMark = (
  measureId: string,
  beamBaseY: number,
  sourceBeats: ILXMBeat[],
  beatLayoutMap: Map<string, ILXMBeatLayout>,
  noteLayouts: ILXMNoteLayout[],
): ILXMDurationMarkLayout[] =>
  sourceBeats.map((beat) => {
    const currentBeat = beatLayoutMap.get(beat.id);
    if (!currentBeat) {
      throw new Error(`beatLayoutMap is empty! beat id: ${beat.id}`);
    }

    // 计算 beamBaseY, 找到最大 Y 坐标的音符，加上一点 offsetY 值
    const beatNotes = noteLayouts.filter((c) => c.beatId === beat.id);
    const beatStemAnchorY = Math.max(...beatNotes.map((c) => c.y));

    // 计算 beamLevel
    const beamLevel = LXM_RHYTHM_BEAM_LEVEL[beat.rhythm.base];

    return {
      beatId: beat.id,
      measureId,
      // 符干坐标
      stemX: currentBeat.x, //  + LXM_DURATION_STEM_OFFSET_X,
      stemY1: beatStemAnchorY + LXM_DURATION_STEM_NOTE_GAP,
      stemY2: beamBaseY,
      // 连梁的 Y 坐标（往上排列，这里与 符干 的 Y 坐标是相同的）
      beamY: beamBaseY,
      beamLevel: beamLevel,
      dots: beat.rhythm.dots,
      dotAnchors: buildDurationDotAnchors(
        currentBeat.x,
        // 附点应与品位数字处于同一视觉层，而不是跟随远离弦线的横梁基线。
        beamBaseY,
        beat.rhythm,
      ),
    };
  });

/** 布局时值连梁/符干 */
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
  const lastStringLine = getLastStringLine(strings);

  if (!lastStringLine) {
    throw new Error("lastStringLine is empty!");
  }

  const beamBaseY = lastStringLine.y2 + LXM_DURATION_BEAM_TOP_OFFSET_Y;
  const durationMarks = buildDurationMark(
    measure.id,
    beamBaseY,
    sourceBeats,
    beatLayoutMap,
    noteLayouts,
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

  return {
    beamSegments,
    durationMarks,
  };
};
