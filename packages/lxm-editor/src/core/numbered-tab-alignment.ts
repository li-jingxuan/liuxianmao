import { LXM_RHYTHM_BASES } from "./constants";
import type { ILXMIdFactory } from "./id-factory";
import {
  buildNumberedIndex,
  createNumberedRhythmContext,
  validateNumberedVoice,
} from "./numbered-rhythm";
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import { createMeasureRhythmContext } from "./tuplet";
import type { ILXMNumberedEvent, ILXMRhythm, ILXMTrack } from "./types";

export interface ILXMNumberedTabAlignmentRange {
  measureId: string;
  startTick: number;
  endTick: number;
}

export type NumberedTabAlignmentResult =
  | {
      ok: true;
      changed: boolean;
      track: ILXMTrack;
      resizedEventIds: string[];
      newGaps: ILXMNumberedEvent[];
    }
  | {
      ok: false;
      code: "MEASURE_NOT_FOUND" | "NUMBERED_INVALID" | "NUMBERED_PARTIAL_RANGE";
      message: string;
    };

/** 精确匹配普通时值，先选无附点写法；不能用近似 tick 或多事件替代一段。 */
const exactRhythm = (ticks: number): ILXMRhythm | undefined => {
  for (const dots of [0, 1, 2])
    for (const base of LXM_RHYTHM_BASES) {
      const rhythm = { base, dots };
      const duration = calculateRhythmTicks(rhythm);
      if (duration.ok && duration.ticks === ticks) return rhythm;
    }
  return undefined;
};

/**
 * 仅按候选 TAB 的真实时间边界细分已有事件。空窗仍由输入位置规划器派生。
 * 不分配全局 ID、不写源对象；组合命令可与 splitBeat 共用同一个局部工厂。
 */
export const planNumberedTabAlignment = (
  track: ILXMTrack,
  range: ILXMNumberedTabAlignmentRange,
  factory: ILXMIdFactory,
): NumberedTabAlignmentResult => {
  const measure = track.measures.find((m) => m.id === range.measureId);
  if (!measure)
    return { ok: false, code: "MEASURE_NOT_FOUND", message: "目标小节不存在" };
  const reject = (detail: string): NumberedTabAlignmentResult => ({
    ok: false,
    code: "NUMBERED_INVALID",
    message: `此范围暂不支持同步细分：${detail}`,
  });
  const { startTick, endTick } = range;
  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  if (
    !Number.isInteger(startTick) ||
    !Number.isInteger(endTick) ||
    startTick < 0 ||
    endTick <= startTick ||
    endTick > capacity
  )
    return reject("请选择同一小节内连续的 TAB 拍点");
  const tabContext = createMeasureRhythmContext(measure);
  const boundaries = new Set<number>();
  for (const beat of measure.beats) {
    const duration = tabContext.getBeatDurationTicks(beat);
    if (!duration.ok) return reject("TAB 时值无效");
    const end = beat.tick + duration.ticks;
    if (
      beat.tick < endTick &&
      end > startTick &&
      tabContext.tupletByBeatId.has(beat.id)
    )
      return reject(`TAB 连音成员 ${beat.id}`);
    boundaries.add(beat.tick);
    boundaries.add(end);
  }
  if (!boundaries.has(startTick) || !boundaries.has(endTick))
    return reject("请选择同一小节内连续的 TAB 拍点");
  const voice = measure.numberedVoice;
  if (validateNumberedVoice(voice, capacity)) return reject("简谱时间范围无效");
  const context = createNumberedRhythmContext(voice);
  const segments = new Map<string, { tick: number; rhythm: ILXMRhythm }[]>();
  const ticks = [...boundaries].sort((a, b) => a - b);
  for (const event of voice.events) {
    const duration = context.getEventDurationTicks(event);
    if (!duration.ok) return reject(`简谱时值 ${event.id}`);
    const end = event.tick + duration.ticks;
    if (event.tick >= endTick || end <= startTick) continue;
    if (event.tick < startTick || end > endTick)
      return {
        ok: false,
        code: "NUMBERED_PARTIAL_RANGE",
        message: "所选范围切穿已有简谱，请扩大到完整音符后重试",
      };
    const cuts = [
      event.tick,
      ...ticks.filter((tick) => tick > event.tick && tick < end),
      end,
    ];
    if (cuts.length === 2) continue;
    if (context.tupletByEventId.has(event.id))
      return reject(`简谱连音成员 ${event.id}`);
    if (event.kind !== "notes" && event.kind !== "gap")
      return reject(`简谱 ${event.kind} 事件 ${event.id}`);
    const parts: { tick: number; rhythm: ILXMRhythm }[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const rhythm = exactRhythm(cuts[i + 1]! - cuts[i]!);
      if (!rhythm) return reject(`事件 ${event.id} 的分段无法精确表示`);
      parts.push({ tick: cuts[i]!, rhythm });
    }
    segments.set(event.id, parts);
  }
  if (!segments.size)
    return {
      ok: true,
      changed: false,
      track,
      resizedEventIds: [],
      newGaps: [],
    };
  const index = buildNumberedIndex(track);
  for (const mark of track.numberedMarks) {
    if (mark.type === "fermata") continue;
    const from =
      mark.type === "tie"
        ? index.items.get(mark.fromItemId)
        : index.events.get(mark.fromEventId);
    const to =
      mark.type === "tie"
        ? index.items.get(mark.toItemId)
        : index.events.get(mark.toEventId);
    if (!from || !to) return reject(`无效连接记号 ${mark.id}`);
    if (
      [...segments.keys()].some((id) => {
        const event = index.events.get(id)!;
        return mark.type === "tie"
          ? id === from.event.id || id === to.event.id
          : event.order >= from.order && event.order <= to.order;
      })
    )
      return reject(`受影响的 ${mark.type} 记号 ${mark.id}`);
  }
  const newGaps: ILXMNumberedEvent[] = [];
  const events = voice.events.flatMap((event) => {
    const parts = segments.get(event.id);
    if (!parts) return [event];
    const gaps = parts.slice(1).map(
      (part): ILXMNumberedEvent => ({
        id: factory.createNumberedEventId(),
        ...part,
        kind: "gap",
        items: [],
      }),
    );
    newGaps.push(...gaps);
    return [{ ...event, rhythm: parts[0]!.rhythm }, ...gaps];
  });
  const numberedVoice = { ...voice, events };
  if (validateNumberedVoice(numberedVoice, capacity))
    return reject("细分后的时间范围无效");
  return {
    ok: true,
    changed: true,
    track: {
      ...track,
      measures: track.measures.map((m) =>
        m === measure ? { ...measure, numberedVoice } : m,
      ),
    },
    resizedEventIds: [...segments.keys()],
    newGaps,
  };
};
