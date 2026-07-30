/**
 * 单小节时值修改与容量重排模块。
 *
 * 这个模块是 beat.setRhythm 背后的领域实现：调用者只提供目标 beat 和新 rhythm，
 * 模块内部统一处理尾部休止、后续 beat 精确压缩以及 tick 重排。页面和命令分发层
 * 不需要理解 DP、压缩优先级或小节容量修复规则。
 */
import { createRestBeats } from "./rest-beats";
import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
  getShorterRhythmOptions,
} from "./rhythm";
import type { ILXMBeat, ILXMMeasure, ILXMRhythm } from "./types";

export type MeasureRhythmChangeErrorCode =
  | "BEAT_NOT_FOUND"
  | "INVALID_RHYTHM"
  | "FOLLOWING_BEATS_CANNOT_COMPRESS"
  | "RHYTHM_NOT_REPRESENTABLE";

export type MeasureRhythmChangeResult =
  | {
      ok: true;
      measure: ILXMMeasure;
      /** 从左到右列出真正被缩短的 beat，便于测试和未来的成功提示。 */
      compressedBeatIds: string[];
    }
  | { ok: false; code: MeasureRhythmChangeErrorCode };

/** DP 中某一个 beat 的选择；level 0 代表保持原 rhythm。 */
interface BeatCompressionChoice {
  rhythm: ILXMRhythm;
  level: number;
  releasedTicks: number;
}

/**
 * 一个 DP 状态对应当前搜索窗口内的完整选择。
 *
 * 三个聚合分数预先存储，避免比较候选方案时反复扫描 choices。choices 本身还承担
 * 最后的稳定 tie-break，确保相同输入在所有运行环境中都得到相同结果。
 */
interface CompressionPlan {
  choices: BeatCompressionChoice[];
  maxLevel: number;
  totalLevels: number;
  changedBeatCount: number;
}

interface CompressionSuccess {
  beats: ILXMBeat[];
  compressedBeatIds: string[];
}

/** 计算一组 beat 的总时长；任一 rhythm 非法时返回 null，不进行取整或容错。 */
const sumBeatDurationTicks = (beats: ILXMBeat[]): number | null => {
  let total = 0;
  for (const beat of beats) {
    const duration = calculateRhythmTicks(beat.rhythm);
    if (!duration.ok) return null;
    total += duration.ticks;
  }
  return total;
};

/**
 * 找到可以整体重建的尾部休止起点。
 *
 * 扫描条件中的 `firstTrailingRest - 1 > targetIndex` 非常重要：当用户选中的目标
 * 本身是尾部 rest 时，目标必须保留其 ID 和新 rhythm；只有目标之后的 rest 才是
 * 可被整体消费、重新分解的容量缓冲。
 */
const findFirstTrailingRestIndexAfterTarget = (
  beats: ILXMBeat[],
  targetIndex: number,
): number => {
  let firstTrailingRest = beats.length;
  while (
    firstTrailingRest - 1 > targetIndex &&
    beats[firstTrailingRest - 1]?.kind === "rest"
  ) {
    firstTrailingRest -= 1;
  }
  return firstTrailingRest;
};

/**
 * 对同一累计释放 tick 的两个方案应用确定性排序。
 *
 * 搜索窗口由外层从近到远扩张，所以“最右影响距离”已经由第一个成功窗口保证。
 * 窗口内部依次偏好：单 beat 最大压缩级数更小、总级数更小、修改 beat 更少；仍
 * 相同时让较早 beat 承担压缩，避免结果依赖 Map 的插入细节。
 */
const isBetterPlan = (
  candidate: CompressionPlan,
  current: CompressionPlan,
): boolean => {
  if (candidate.maxLevel !== current.maxLevel)
    return candidate.maxLevel < current.maxLevel;
  if (candidate.totalLevels !== current.totalLevels)
    return candidate.totalLevels < current.totalLevels;
  if (candidate.changedBeatCount !== current.changedBeatCount)
    return candidate.changedBeatCount < current.changedBeatCount;

  for (let index = 0; index < candidate.choices.length; index += 1) {
    const candidateLevel = candidate.choices[index]?.level ?? 0;
    const currentLevel = current.choices[index]?.level ?? 0;
    if (candidateLevel !== currentLevel) return candidateLevel > currentLevel;
  }
  return false;
};

/** 为一个 beat 生成“保持不变 + 所有同附点缩短候选”。 */
const getBeatCompressionChoices = (
  beat: ILXMBeat,
): BeatCompressionChoice[] | null => {
  const originalDuration = calculateRhythmTicks(beat.rhythm);
  if (!originalDuration.ok) return null;

  return [
    { rhythm: beat.rhythm, level: 0, releasedTicks: 0 },
    ...getShorterRhythmOptions(beat.rhythm).map((option) => ({
      rhythm: option.rhythm,
      level: option.level,
      releasedTicks: originalDuration.ticks - option.ticks,
    })),
  ];
};

/** 把一个 beat 选择追加到已有 DP 方案，并增量维护排序分数。 */
const appendChoice = (
  plan: CompressionPlan,
  choice: BeatCompressionChoice,
): CompressionPlan => ({
  choices: [...plan.choices, choice],
  maxLevel: Math.max(plan.maxLevel, choice.level),
  totalLevels: plan.totalLevels + choice.level,
  changedBeatCount: plan.changedBeatCount + (choice.level > 0 ? 1 : 0),
});

/**
 * DP 不能只为一个 releasedTicks 保留单一方案。
 *
 * maxLevel 是非加法分数：当前 maxLevel=1 的方案看似优于 maxLevel=2，但如果后续
 * 必须追加 level=3，两者的最终 maxLevel 都会变成 3，此时原先被丢弃的方案可能因
 * totalLevels 更小而胜出。因此每个累计 tick 需要按 maxLevel 保留一组帕累托状态；
 * 只有 releasedTicks 和 maxLevel 都相同时，才可以安全地用剩余评分淘汰方案。
 */
type CompressionStates = Map<number, Map<number, CompressionPlan>>;

const storePlan = (
  states: CompressionStates,
  releasedTicks: number,
  candidate: CompressionPlan,
) => {
  const plansByMaxLevel = states.get(releasedTicks) ?? new Map();
  const current = plansByMaxLevel.get(candidate.maxLevel);
  if (!current || isBetterPlan(candidate, current)) {
    plansByMaxLevel.set(candidate.maxLevel, candidate);
    states.set(releasedTicks, plansByMaxLevel);
  }
};

/** 从一个精确 tick 状态的不同 maxLevel 方案中选出最终全局最优解。 */
const selectBestPlan = (
  plansByMaxLevel: Map<number, CompressionPlan>,
): CompressionPlan | null => {
  let best: CompressionPlan | null = null;
  for (const plan of plansByMaxLevel.values()) {
    if (!best || isBetterPlan(plan, best)) best = plan;
  }
  return best;
};

/**
 * 在目标右侧寻找释放量严格等于 overflowTicks 的方案。
 *
 * states 的 key 是累计释放 tick；value 是该 tick 下评分最优的选择。每处理一个
 * beat 就形成一个更大的局部窗口，并立刻检查精确解。因此第一次成功天然只影响
 * 离目标最近的一段 beat。超过 overflow 的状态不会再回落，直接丢弃即可。
 */
const applyExactFollowingCompression = (
  fixedBeats: ILXMBeat[],
  targetIndex: number,
  overflowTicks: number,
): CompressionSuccess | null => {
  const followingBeats = fixedBeats.slice(targetIndex + 1);
  let states: CompressionStates = new Map([
    [
      0,
      new Map([
        [
          0,
          {
            choices: [],
            maxLevel: 0,
            totalLevels: 0,
            changedBeatCount: 0,
          },
        ],
      ]),
    ],
  ]);

  for (let offset = 0; offset < followingBeats.length; offset += 1) {
    const currentBeat = followingBeats[offset]!;
    const choices = getBeatCompressionChoices(currentBeat);
    if (!choices) return null;

    const nextStates: CompressionStates = new Map();
    for (const [releasedTicks, plansByMaxLevel] of states) {
      for (const plan of plansByMaxLevel.values()) {
        for (const choice of choices) {
          const nextReleasedTicks = releasedTicks + choice.releasedTicks;
          if (nextReleasedTicks > overflowTicks) continue;

          storePlan(nextStates, nextReleasedTicks, appendChoice(plan, choice));
        }
      }
    }
    states = nextStates;

    const exactStates = states.get(overflowTicks);
    const exactPlan = exactStates ? selectBestPlan(exactStates) : null;
    if (!exactPlan) continue;

    const replacementByBeatId = new Map<string, BeatCompressionChoice>();
    exactPlan.choices.forEach((choice, choiceIndex) => {
      replacementByBeatId.set(followingBeats[choiceIndex]!.id, choice);
    });

    const compressedBeatIds: string[] = [];
    const beats = fixedBeats.map((beat) => {
      const choice = replacementByBeatId.get(beat.id);
      if (!choice || choice.level === 0) return beat;
      compressedBeatIds.push(beat.id);
      return { ...beat, rhythm: choice.rhythm };
    });
    return { beats, compressedBeatIds };
  }

  return null;
};

/**
 * 从 0 开始重新累计 tick，而不是在旧 tick 上反复加减 delta。
 *
 * 这样时间轴连续性只有一个来源；多次编辑不会积累偏移误差。tick 未变化的 beat
 * 直接复用原对象，既保持不可变语义，也减少无关引用变化。
 */
const reflowBeatTicks = (beats: ILXMBeat[]): ILXMBeat[] | null => {
  let tick = 0;
  const result: ILXMBeat[] = [];
  for (const beat of beats) {
    const duration = calculateRhythmTicks(beat.rhythm);
    if (!duration.ok) return null;
    result.push(beat.tick === tick ? beat : { ...beat, tick });
    tick += duration.ticks;
  }
  return result;
};

/**
 * 修改一个小节内目标 beat 的 rhythm，并返回容量完整的新小节。
 *
 * 这是纯领域规划：输入 measure 不会被原地修改；失败不创建部分结果。调用者仍需在
 * 文档级别递增 revision，并执行 schema 与 semantic validation 两层最终守卫。
 */
export const changeMeasureBeatRhythm = (
  measure: ILXMMeasure,
  beatId: string,
  rhythm: ILXMRhythm,
  createBeatId: () => string,
): MeasureRhythmChangeResult => {
  const targetIndex = measure.beats.findIndex((beat) => beat.id === beatId);
  if (targetIndex < 0) return { ok: false, code: "BEAT_NOT_FOUND" };

  const target = measure.beats[targetIndex]!;
  const previousDuration = calculateRhythmTicks(target.rhythm);
  const nextDuration = calculateRhythmTicks(rhythm);
  if (!previousDuration.ok || !nextDuration.ok)
    return { ok: false, code: "INVALID_RHYTHM" };

  // 只复制目标 beat；其他对象先复用，后续仅在 rhythm 或 tick 实际变化时再复制。
  const candidate = measure.beats.map((beat, index) =>
    index === targetIndex ? { ...beat, rhythm } : beat,
  );
  const firstTrailingRestIndex = findFirstTrailingRestIndexAfterTarget(
    candidate,
    targetIndex,
  );
  const fixedBeats = candidate.slice(0, firstTrailingRestIndex);
  const fixedEndTicks = sumBeatDurationTicks(fixedBeats);
  if (fixedEndTicks === null) return { ok: false, code: "INVALID_RHYTHM" };

  const capacityTicks = getMeasureCapacityTicks(measure.timeSignature);
  const overflowTicks = Math.max(0, fixedEndTicks - capacityTicks);
  const compression =
    overflowTicks === 0
      ? { beats: fixedBeats, compressedBeatIds: [] }
      : applyExactFollowingCompression(fixedBeats, targetIndex, overflowTicks);
  if (!compression) {
    return { ok: false, code: "FOLLOWING_BEATS_CANNOT_COMPRESS" };
  }

  const reflowedFixedBeats = reflowBeatTicks(compression.beats);
  if (!reflowedFixedBeats) return { ok: false, code: "INVALID_RHYTHM" };
  const reflowedFixedTicks = sumBeatDurationTicks(reflowedFixedBeats);
  if (reflowedFixedTicks === null) return { ok: false, code: "INVALID_RHYTHM" };

  const trailingRestTicks = capacityTicks - reflowedFixedTicks;
  const trailingRests = createRestBeats(
    reflowedFixedTicks,
    trailingRestTicks,
    createBeatId,
  );
  if (!trailingRests) return { ok: false, code: "RHYTHM_NOT_REPRESENTABLE" };

  return {
    ok: true,
    measure: {
      ...measure,
      beats: [...reflowedFixedBeats, ...trailingRests],
    },
    compressedBeatIds: compression.compressedBeatIds,
  };
};
