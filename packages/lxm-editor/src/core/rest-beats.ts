/**
 * 休止 beat 构造模块。
 *
 * rhythm.ts 只负责把静音时长分解为 rhythm；这里再补齐 beat ID、连续 tick、kind
 * 和空 notes。任意静音时长与空白小节初始化分别保留各自的节奏拼写策略，但共享同一
 * 份基础时值和 beat 数据结构。
 */
import { TICKS_PER_QUARTER } from "./constants";
import {
  BASE_RHYTHM_TICKS,
  calculateRhythmTicks,
  createRestRhythmsForTicks,
  getMeasureCapacityTicks,
} from "./rhythm";
import type { ILXMBeat, ILXMRhythm, ILXMTimeSignature } from "./types";

/**
 * 从 startTick 开始创建一段连续休止。
 *
 * 返回 null 表示 ticks 无法被当前 rhythm 集合精确表示。函数不会修改外部数据；
 * createBeatId 只在分解成功后调用，因此失败规划不会无意义地消耗 ID。
 */
export const createRestBeats = (
  startTick: number,
  ticks: number,
  createBeatId: () => string,
): ILXMBeat[] | null => {
  const result = createRestRhythmsForTicks(ticks);
  if (!result.ok) return null;

  let tick = startTick;
  return result.rhythms.map((rhythm) => {
    const duration = calculateRhythmTicks(rhythm);
    // createRestRhythmsForTicks 只会输出可计算的 rhythm。这里保留断言式守卫，让
    // 将来新增 rhythm 类型时能尽早暴露两个工具之间的契约破坏。
    if (!duration.ok) throw new Error("休止节奏分解产生了无效 rhythm");

    const rest: ILXMBeat = {
      id: createBeatId(),
      tick,
      rhythm,
      kind: "rest",
      notes: [],
    };
    tick += duration.ticks;
    return rest;
  });
};

/**
 * 按拍号的单位拍创建空白小节。
 *
 * 常规拍号使用分子个单位拍休止符，例如 4/4 创建四个 quarter、6/8 创建六个
 * eighth。若分母无法由当前基础时值直接表达，则沿用整段静音的贪心分解，避免收窄
 * 现有 schema 所允许的拍号范围。
 */
export const createMeasureRestBeats = (
  timeSignature: ILXMTimeSignature,
  createBeatId: () => string,
): ILXMBeat[] | null => {
  const { numerator, denominator } = timeSignature;
  if (
    !Number.isInteger(numerator) ||
    numerator <= 0 ||
    !Number.isInteger(denominator) ||
    denominator <= 0
  )
    return null;

  const unitTicks = (TICKS_PER_QUARTER * 4) / denominator;
  const capacity = getMeasureCapacityTicks(timeSignature);
  if (
    !Number.isInteger(unitTicks) ||
    unitTicks <= 0 ||
    !Number.isInteger(capacity) ||
    capacity <= 0 ||
    numerator * unitTicks !== capacity
  )
    return null;

  const unitBase = (
    Object.entries(BASE_RHYTHM_TICKS) as [ILXMRhythm["base"], number][]
  ).find(([, ticks]) => ticks === unitTicks)?.[0];

  if (!unitBase) return createRestBeats(0, capacity, createBeatId);

  return Array.from({ length: numerator }, (_, index) => ({
    id: createBeatId(),
    tick: index * unitTicks,
    rhythm: { base: unitBase, dots: 0 },
    kind: "rest",
    notes: [],
  }));
};
