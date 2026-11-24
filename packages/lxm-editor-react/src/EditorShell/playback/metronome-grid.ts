import {
  LXM_EDITABLE_TIME_SIGNATURES,
  MAX_PLAYBACK_BPM,
  MIN_PLAYBACK_BPM,
  TICKS_PER_QUARTER,
  type ILXMMeasure,
  type ILXMTimeSignature,
  type PlaybackPlan,
} from "@liuxianmao/lxm-editor";

export const DEFAULT_METER: ILXMTimeSignature = { numerator: 4, denominator: 4 };
export const meterLabel = ({ numerator, denominator }: ILXMTimeSignature) => `${numerator}/${denominator}`;
export const practiceMeters = LXM_EDITABLE_TIME_SIGNATURES;
export const isMetronomeBpm = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_PLAYBACK_BPM && value <= MAX_PLAYBACK_BPM;

export function readMeter(value: ILXMTimeSignature | undefined) {
  return value && Number.isSafeInteger(value.numerator) && value.numerator > 0 &&
    Number.isSafeInteger(value.denominator) && value.denominator > 0 ? value : null;
}

export interface ScoreMetronomeBeat {
  tick: number;
  number: number;
}

// 不用相除后的四舍五入判断边界：导入拍号可能产生分数 tick，严格查找下一拍时必须越过当前 tick。
function findBeatIndex(visit: { startTick: number; step: number; meter: ILXMTimeSignature }, tick: number, inclusive: boolean) {
  let lower = 0;
  let upper = visit.meter.numerator;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const at = visit.startTick + middle * visit.step;
    if (at < tick || (!inclusive && at === tick)) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

// 每个播放访问独立起拍。以音频计划的实际结束时刻裁掉弱起或不完整小节的剩余拍点；
// 反复和中间起播已由计划展开，休止和没有书写节奏的空白仍按分母计拍。
export function createScoreMetronomeGrid(plan: PlaybackPlan, measures: readonly Pick<ILXMMeasure, "timeSignature">[]) {
  const visits = plan.visits.map((visit) => {
    const meter = readMeter(measures[visit.measureIndex]?.timeSignature) ?? DEFAULT_METER;
    return { ...visit, meter, step: 4 * TICKS_PER_QUARTER / meter.denominator };
  });
  const visitIndexAt = (tick: number) => {
    let lower = 0;
    let upper = visits.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (visits[middle]!.endTick <= tick) lower = middle + 1;
      else upper = middle;
    }
    return lower;
  };
  return {
    meterAt: (tick: number) => visits[visitIndexAt(tick)]?.meter,
    beatAt(tick: number): ScoreMetronomeBeat | null {
      const visit = visits[visitIndexAt(tick)];
      if (!visit || tick < visit.startTick) return null;
      const index = findBeatIndex(visit, tick, false) - 1;
      return { tick: visit.startTick + index * visit.step, number: index + 1 };
    },
    nextBeat(tick: number, inclusive: boolean): ScoreMetronomeBeat | null {
      for (let i = visitIndexAt(tick); i < visits.length; i++) {
        const visit = visits[i]!;
        const index = findBeatIndex(visit, tick, inclusive);
        const at = visit.startTick + index * visit.step;
        if (index < visit.meter.numerator && at < visit.endTick) return { tick: at, number: index + 1 };
      }
      return null;
    },
  };
}

export type ScoreMetronomeGrid = ReturnType<typeof createScoreMetronomeGrid>;
