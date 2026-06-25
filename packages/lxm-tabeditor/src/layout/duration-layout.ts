import type { Beat, RhythmValue, TimeSignature } from "../core/schema";
import { DURATION_LEVEL_GAP } from "./layout-constants";
import { getBeatGroupIndex } from "./layout-helpers";
import type { LaidOutBeamSegment, LaidOutDurationMark } from "./layout-types";

/**
 * 时值专属排版工具。
 *
 * 这部分逻辑和普通 fret / rest 排版不同，它处理的是 notehead、符干、符尾和连梁的
 * 视觉规则。把它独立出来之后，`measure-layout` 可以只负责“组装小节”，而不是同时
 * 维护所有时值细节。
 */

/** whole / half 用空心头，quarter 及更短时值统一用实心头。 */
export const getDurationNotehead = (
  base: RhythmValue["base"],
): LaidOutDurationMark["notehead"] => {
  switch (base) {
    case "whole":
      return "whole";
    case "half":
      return "half";
    default:
      return "filled";
  }
};

/** flagCount 表示该 beat 需要几层符尾；参与连梁时同样用于决定连梁层数。 */
export const getDurationFlagCount = (
  base: RhythmValue["base"],
): 0 | 1 | 2 | 3 => {
  switch (base) {
    case "eighth":
      return 1;
    case "sixteenth":
      return 2;
    case "thirtySecond":
      return 3;
    default:
      return 0;
  }
};

/** whole 只有时值头没有符干，其余常规音符都绘制符干。 */
export const hasDurationStem = (base: RhythmValue["base"]): boolean =>
  base !== "whole";

/**
 * 多层时值元素的统一 Y 轴公式。
 *
 * 三十二分音符会同时拥有三层符尾/连梁；如果 beam 和 flag 各自使用不同间距，
 * 第 2、3 层就会出现错位。layout 层统一输出这个坐标，页面层只负责绘制。
 */
export const getDurationLevelY = (
  mark: Pick<LaidOutDurationMark, "stemBaseY">,
  level: 1 | 2 | 3,
): number => mark.stemBaseY - (level - 1) * DURATION_LEVEL_GAP;

/**
 * 连梁片段的 MVP 规则：
 * 1. 只在 notes beat 之间分组，rest 会中断；
 * 2. 只处理需要对应 level 连梁的短时值；
 * 3. 同一拍组内部，同一段连续 beat 至少两个时，输出 kind="shared" 的完整共享连梁；
 * 4. 高层级只有单个 beat 且同拍组内旁边存在低一层节奏上下文时，输出 kind="partial" 的短横线。
 *
 * 这样能把完整连梁和 partial beam 统一建模成 beamSegments，页面层只需要按 kind 渲染，
 * 不需要通过 beatIds 长度等隐式规则猜测片段语义。
 *
 * 注意：连梁是否断开，不能只看“短时值是否连续”，还要看它们是否已经跨过拍边界。
 * 例如 4/4 中第 3 拍末尾的八分音符，即使后面紧跟第 4 拍开头的八分音符，也应当在
 * 拍边界处分成两段 shared beam，而不是连成一整排。
 */

export const buildBeamSegments = (
  beats: Beat[],
  durationMarkByBeatId: Map<string, LaidOutDurationMark>,
  timeSignature: TimeSignature,
): LaidOutBeamSegment[] => {
  const beamSegments: LaidOutBeamSegment[] = [];
  const hasLowerLevelContext = (
    beatIndex: number,
    anchorBeatIndex: number,
    level: 2 | 3,
  ): boolean => {
    const beat = beats[beatIndex];
    const anchorBeat = beats[anchorBeatIndex];
    if (!beat || !anchorBeat || beat.kind !== "notes" || anchorBeat.kind !== "notes") {
      return false;
    }
    const mark = durationMarkByBeatId.get(beat.id);
    return Boolean(
      mark &&
        mark.flagCount >= level - 1 &&
          getBeatGroupIndex(beat.tick, timeSignature) ===
            getBeatGroupIndex(anchorBeat.tick, timeSignature),
    );
  };

  const flushRun = (
    level: 1 | 2 | 3,
    run: LaidOutDurationMark[],
    measureId: string,
    startBeatIndex: number,
    endBeatIndex: number,
  ) => {
    if (run.length >= 2) {
      beamSegments.push({
        kind: "shared",
        measureId,
        beatIds: run.map((mark) => mark.beatId),
        level,
        x1: run[0]!.stemX,
        x2: run[run.length - 1]!.stemX,
        y: getDurationLevelY(run[0]!, level),
      });
      return;
    }

    if (run.length !== 1 || level === 1) return;

    const mark = run[0]!;
    const hasLeftNeighbor = hasLowerLevelContext(
      startBeatIndex - 1,
      startBeatIndex,
      level,
    );
    const hasRightNeighbor = hasLowerLevelContext(
      endBeatIndex + 1,
      startBeatIndex,
      level,
    );

    /**
     * 当某一层连梁只有单个 beat 时，统一输出 kind="partial" 的 beam segment，
     * 而不是退回为 flag。如果它左侧存在同段较低层节奏上下文，则短横线朝左；
     * 否则朝右。这样可以覆盖“附点八分 + 十六分”的常见记谱。
     */
    if (hasLeftNeighbor || hasRightNeighbor) {
      const direction = hasLeftNeighbor ? "left" : "right";
      beamSegments.push({
        kind: "partial",
        measureId: mark.measureId,
        beatId: mark.beatId,
        level,
        direction,
        x1: direction === "left" ? mark.stemX - 10 : mark.stemX,
        x2: direction === "left" ? mark.stemX : mark.stemX + 10,
        y: getDurationLevelY(mark, level),
      });
    }
  };

  ([1, 2, 3] as const).forEach((level) => {
    let run: LaidOutDurationMark[] = [];
    let measureId = "";
    let runStartBeatIndex = -1;
    let runGroupIndex = -1;

    const resetRun = () => {
      run = [];
      measureId = "";
      runStartBeatIndex = -1;
      runGroupIndex = -1;
    };

    for (const [beatIndex, beat] of beats.entries()) {
      // rest 天然中断连梁；跨过休止后必须重新开始新的拍组扫描。
      if (beat.kind !== "notes") {
        flushRun(level, run, measureId, runStartBeatIndex, beatIndex - 1);
        resetRun();
        continue;
      }

      const mark = durationMarkByBeatId.get(beat.id);
      
      /**
       * 当前 beat 不能参与这一层 level 的连梁时，需要先把前面积累的 run 输出掉，
       * 然后把 run 状态清空：
       * 1. `!mark` 说明这个 beat 没有对应的时值排版结果，无法提供 stem / flag 几何锚点；
       * 2. `mark.flagCount < level` 说明它只属于较低层级的时值，例如十六分音符不会参与第 3 层
       *    （三十二分）连梁。
       *
       * 因此这里的语义是“遇到当前层级的连梁边界，立即截断前一段 run”，避免把不同层级的
       * 短时值错误地串成同一个 beam segment。
       */
      if (!mark || mark.flagCount < level) {
        flushRun(level, run, measureId, runStartBeatIndex, beatIndex - 1);
        resetRun();
        continue;
      }

      const currentGroupIndex = getBeatGroupIndex(beat.tick, timeSignature);

      /**
       * 连梁 run 还要受拍组边界约束：
       * - 4/4 中 level=1 的八分层 shared beam 不能从第 3 拍一路连到第 4 拍；
       * - 编辑态把长 beat materialize 成多个真实 beat 后，也仍然只按 beat.tick 所属拍组断开。
       *
       * 因此一旦当前 beat 进入新的拍组，就先结算前一段 run，再把它当成新 run 的起点。
       */
      if (run.length > 0 && currentGroupIndex !== runGroupIndex) {
        flushRun(level, run, measureId, runStartBeatIndex, beatIndex - 1);
        resetRun();
      }

      if (run.length === 0) {
        measureId = mark.measureId;
        runStartBeatIndex = beatIndex;
        runGroupIndex = currentGroupIndex;
      }
      run.push(mark);
    }

    flushRun(level, run, measureId, runStartBeatIndex, beats.length - 1);
  });

  return beamSegments;
};
