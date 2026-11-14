import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
  getTimeSignatureBeatGroupTicks,
} from "../rhythm/rhythm";
import { createNumberedRhythmContext } from "./numbered-rhythm";
import { numberedRhythmForTicks } from "./numbered-input-ranges";
import type { ILXMMeasure, ILXMNumberedVoice, ILXMRhythm } from "../types";

export type NumberedTimelineErrorCode =
  | "EVENT_NOT_FOUND"
  | "INVALID_RHYTHM"
  | "EVENT_IN_TUPLET"
  | "TIMELINE_OVERFLOW"
  | "CANNOT_COMPRESS";

export type NumberedTimelineResult =
  | {
      ok: true;
      voice: ILXMNumberedVoice;
      movedEventIds: string[];
      resizedEventIds: string[];
      overwrittenEventIds: string[];
      releasedRange?: { startTick: number; endTick: number };
    }
  | { ok: false; code: NumberedTimelineErrorCode; message: string };

/**
 * 普通时值修改使用固定时间窗：延长吞并覆盖的后音，缩短释放空位。
 * 同 base 的附点调整只与紧邻后音互补，保持后音结束与其后的时间不变；
 * 这样连续四个十六分音符加点再减点可恢复原来的四个起点。
 * 预览与提交必须消费这一份规划，不能在 UI 另做时间推移。
 */
export const planNumberedEventRhythm = (
  measure: ILXMMeasure,
  eventId: string,
  rhythm: ILXMRhythm,
): NumberedTimelineResult => {
  const voice = measure.numberedVoice;
  const events = [...voice.events].sort((a, b) => a.tick - b.tick);
  const index = events.findIndex((event) => event.id === eventId);
  if (index < 0)
    return { ok: false, code: "EVENT_NOT_FOUND", message: "简谱事件不存在" };
  const target = events[index]!;
  const context = createNumberedRhythmContext(voice);
  if (context.tupletByEventId.has(eventId))
    return { ok: false, code: "EVENT_IN_TUPLET", message: "连音成员须整组修改时值" };
  const previous = context.getEventDurationTicks(target);
  const next = calculateRhythmTicks(rhythm);
  if (!previous.ok || !next.ok)
    return { ok: false, code: "INVALID_RHYTHM", message: "简谱时值无效" };
  const result: Extract<NumberedTimelineResult, { ok: true }> = {
    ok: true, voice, movedEventIds: [], resizedEventIds: [], overwrittenEventIds: [],
  };
  if (target.rhythm.base === rhythm.base && target.rhythm.dots === rhythm.dots) return result;
  const oldEnd = target.tick + previous.ticks;
  const endTick = target.tick + next.ticks;
  if (endTick > getMeasureCapacityTicks(measure.timeSignature))
    return { ok: false, code: "TIMELINE_OVERFLOW", message: "简谱时值超出小节容量" };
  const updates = new Map([[target.id, { ...target, rhythm: { ...rhythm } }]]);
  result.resizedEventIds.push(target.id);
  if (target.rhythm.base === rhythm.base && target.rhythm.dots !== rhythm.dots) {
    const following = events[index + 1];
    const growing = next.ticks > previous.ticks;
    // 有空白时先消耗/释放空白；只有真正相接或被新附点占用的后音参与互补。
    const adjust = following && (growing ? following.tick < endTick : following.kind !== "gap" && following.tick === oldEnd);
    if (adjust && growing && following.kind === "gap") {
      // 显式空格仍是空白，不能因附点切出不可编码的小尾量而阻止原本合法的延长。
      // 可编码尾格保留身份；不可编码尾格退回隐式空白，关联内容由提交层确认。
      const covered = events.filter(event => event.id !== target.id && event.tick >= oldEnd && event.tick < endTick);
      if (covered.some(event => context.tupletByEventId.has(event.id)))
        return { ok: false, code: "EVENT_IN_TUPLET", message: "附点调整不能改变后续连音成员" };
      if (covered.some(event => event.kind !== "gap"))
        return { ok: false, code: "CANNOT_COMPRESS", message: "附点修改超出后方空白，请先调整相邻音符或空位" };
      for (const gap of covered) {
        const duration = context.getEventDurationTicks(gap);
        const complement = duration.ok ? numberedRhythmForTicks(gap.tick + duration.ticks - endTick) : undefined;
        if (complement) {
          updates.set(gap.id, { ...gap, tick: endTick, rhythm: { ...complement } });
          result.movedEventIds.push(gap.id);
          result.resizedEventIds.push(gap.id);
        } else result.overwrittenEventIds.push(gap.id);
      }
    } else if (adjust) {
      const duration = context.getEventDurationTicks(following);
      const followingEnd = duration.ok ? following.tick + duration.ticks : NaN;
      let boundary = 0;
      for (const ticks of getTimeSignatureBeatGroupTicks(measure.timeSignature) ?? [getMeasureCapacityTicks(measure.timeSignature)]) {
        boundary += ticks;
        if (boundary > target.tick) break;
      }
      const complement = numberedRhythmForTicks(followingEnd - endTick);
      if (context.tupletByEventId.has(following.id))
        return { ok: false, code: "EVENT_IN_TUPLET", message: "附点调整不能改变后续连音成员" };
      if (!complement || followingEnd > boundary || endTick >= followingEnd)
        return { ok: false, code: "CANNOT_COMPRESS", message: "本拍内相邻音符没有可互补的时值，请先调整相邻音符或空位" };
      updates.set(following.id, { ...following, tick: endTick, rhythm: { ...complement } });
      result.movedEventIds.push(following.id);
      result.resizedEventIds.push(following.id);
    }
  } else if (next.ticks > previous.ticks) {
    const covered = events.filter(event => event.id !== eventId && event.tick >= target.tick && event.tick < endTick);
    if (covered.some(event => context.tupletByEventId.has(event.id)))
      return { ok: false, code: "EVENT_IN_TUPLET", message: "时值扩展不能覆盖连音组，请使用整组窗口编辑" };
    result.overwrittenEventIds = covered.map(event => event.id);
  }
  const removed = new Set(result.overwrittenEventIds);
  result.voice = { ...voice, events: events.filter(event => !removed.has(event.id)).map(event => updates.get(event.id) ?? event) };
  if (next.ticks < previous.ticks && !result.movedEventIds.length)
    result.releasedRange = { startTick: endTick, endTick: oldEnd };
  return result;
};
