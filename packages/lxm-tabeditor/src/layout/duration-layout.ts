import type { Beat, RhythmValue } from "../core/schema";
import { DURATION_LEVEL_GAP } from "./layout-constants";
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
 * 连梁片段的 MVP 规则：
 * 1. 只在 notes beat 之间分组，rest 会中断；
 * 2. 只处理需要对应 level 连梁的短时值；
 * 3. 同一段连续 beat 至少两个时，输出 kind="shared" 的完整共享连梁；
 * 4. 高层级只有单个 beat 且旁边存在低一层节奏上下文时，输出 kind="partial" 的短横线。
 *
 * 这样能把完整连梁和 partial beam 统一建模成 beamSegments，页面层只需要按 kind 渲染，
 * 不需要通过 beatIds 长度等隐式规则猜测片段语义。
 */
export const buildBeamSegments = (
  beats: Beat[],
  durationMarkByBeatId: Map<string, LaidOutDurationMark>,
): LaidOutBeamSegment[] => {
  const beamSegments: LaidOutBeamSegment[] = [];

  const hasLowerLevelContext = (
    beatIndex: number,
    level: 2 | 3,
  ): boolean => {
    const beat = beats[beatIndex];
    if (!beat || beat.kind !== "notes") return false;
    const mark = durationMarkByBeatId.get(beat.id);
    return Boolean(mark && mark.flagCount >= level - 1);
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
        y: run[0]!.stemBaseY + (level - 1) * DURATION_LEVEL_GAP,
      });
      return;
    }

    if (run.length !== 1 || level === 1) return;

    const mark = run[0]!;
    const hasLeftNeighbor = hasLowerLevelContext(startBeatIndex - 1, level);
    const hasRightNeighbor = hasLowerLevelContext(endBeatIndex + 1, level);

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
        y: mark.stemBaseY - (level - 1) * DURATION_LEVEL_GAP,
      });
    }
  };

  ([1, 2, 3] as const).forEach((level) => {
    let run: LaidOutDurationMark[] = [];
    let measureId = "";
    let runStartBeatIndex = -1;

    for (const [beatIndex, beat] of beats.entries()) {
      if (beat.kind !== "notes") {
        flushRun(level, run, measureId, runStartBeatIndex, beatIndex - 1);
        run = [];
        measureId = "";
        runStartBeatIndex = -1;
        continue;
      }

      const mark = durationMarkByBeatId.get(beat.id);
      if (!mark || mark.flagCount < level) {
        flushRun(level, run, measureId, runStartBeatIndex, beatIndex - 1);
        run = [];
        measureId = "";
        runStartBeatIndex = -1;
        continue;
      }

      if (run.length === 0) {
        measureId = mark.measureId;
        runStartBeatIndex = beatIndex;
      }
      run.push(mark);
    }

    flushRun(level, run, measureId, runStartBeatIndex, beats.length - 1);
  });

  return beamSegments;
};
