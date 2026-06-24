import {
  calculateRhythmTicks,
  partitionTickRangeToRhythms,
} from "../core/rhythm";
import type { Beat, Measure, RhythmValue, TimeSignature } from "../core/schema";

const cloneBeatAsRest = (
  source: Beat,
  suffix: string,
  tick: number,
  rhythm: RhythmValue,
): Beat => ({
  id: `${source.id}__${suffix}`,
  tick,
  rhythm,
  kind: "rest",
});

/**
 * 在真实时间线上 materialize 一个 slot 写入目标。
 *
 * layout 层的 editGrid 只是一组派生 slot；真正写入 score 时必须把“覆盖该 slot
 * 的长 beat”切成可以保存的真实 beat。这个函数只替换被命中的 covering beat：
 * - 前半段切成 rest，保留空白时间；
 * - 中间插入调用方给出的 nextBeat；
 * - 后半段继续切成 rest；
 * - 其他 beat 原样保留并按 tick 排序。
 *
 * 这里没有把占位 slot 写回 schema，所以撤销重做、校验、播放和导出仍然只看到真实
 * 音乐事件。若目标 tick 不在覆盖 beat 内，说明 UI 命中或命令 payload 有误，直接失败。
 */
export const materializeBeatAtTick = ({
  measure,
  tick,
  rhythm,
  nextBeat,
  coveringBeatId,
  timeSignature,
}: {
  measure: Measure;
  tick: number;
  rhythm: RhythmValue;
  nextBeat: Beat;
  coveringBeatId?: string;
  timeSignature: TimeSignature;
}): Beat[] => {
  const targetTicks = calculateRhythmTicks(rhythm);
  if (!targetTicks.ok) {
    throw new Error("无法 materialize 非整数 tick 时值");
  }

  const coveringBeat = coveringBeatId
    ? measure.beats.find((beat) => beat.id === coveringBeatId)
    : measure.beats.find((beat) => {
        const beatTicks = calculateRhythmTicks(beat.rhythm);
        return beatTicks.ok && tick >= beat.tick && tick < beat.tick + beatTicks.ticks;
      });
  if (!coveringBeat) {
    throw new Error("目标 tick 没有对应的真实 beat");
  }

  const coveringTicks = calculateRhythmTicks(coveringBeat.rhythm);
  if (!coveringTicks.ok) {
    throw new Error("覆盖 beat 的时值无法换算为整数 tick");
  }

  const coveringStart = coveringBeat.tick;
  const coveringEnd = coveringStart + coveringTicks.ticks;
  const targetEnd = tick + targetTicks.ticks;
  if (tick < coveringStart || targetEnd > coveringEnd) {
    throw new Error("目标 slot 超出覆盖 beat 的时间范围");
  }

  const before = partitionTickRangeToRhythms(
    coveringStart,
    tick,
    timeSignature,
  ).map((fragment, index) =>
    cloneBeatAsRest(coveringBeat, `rest_before_${index}`, fragment.tick, fragment.rhythm),
  );
  const after = partitionTickRangeToRhythms(
    targetEnd,
    coveringEnd,
    timeSignature,
  ).map((fragment, index) =>
    cloneBeatAsRest(coveringBeat, `rest_after_${index}`, fragment.tick, fragment.rhythm),
  );

  return measure.beats
    .flatMap((beat) =>
      beat.id === coveringBeat.id ? [...before, nextBeat, ...after] : [beat],
    )
    .sort((a, b) => a.tick - b.tick);
};
