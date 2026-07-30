/**
 * 休止 beat 构造模块。
 *
 * rhythm.ts 只负责把静音时长分解为 rhythm；这里再补齐 beat ID、连续 tick、kind
 * 和空 notes。小节插入与时值重排都使用同一个构造入口，避免两处实现逐渐产生不同
 * 的休止结构。
 */
import { calculateRhythmTicks, createRestRhythmsForTicks } from "./rhythm";
import type { ILXMBeat } from "./types";

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
