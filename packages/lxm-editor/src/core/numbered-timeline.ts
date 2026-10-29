import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
  getShorterRhythmOptions,
} from "./rhythm";
import { createNumberedRhythmContext } from "./numbered-rhythm";
import type {
  ILXMMeasure,
  ILXMNumberedEvent,
  ILXMNumberedVoice,
  ILXMRhythm,
} from "./types";

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
      releasedRange?: { startTick: number; endTick: number };
    }
  | { ok: false; code: NumberedTimelineErrorCode; message: string };

type Choice = {
  rhythm: ILXMRhythm;
  release: number;
  level: number;
};

type Plan = {
  choices: Choice[];
  totalRelease: number;
  totalLevel: number;
  changed: number;
};

const better = (candidate: Plan, current: Plan): boolean => {
  if (candidate.totalLevel !== current.totalLevel)
    return candidate.totalLevel < current.totalLevel;
  if (candidate.changed !== current.changed)
    return candidate.changed < current.changed;
  for (const [index, choice] of candidate.choices.entries()) {
    const other = current.choices[index]?.level ?? 0;
    if (choice.level !== other) return choice.level > other;
  }
  return false;
};

const chooseCompression = (
  events: ILXMNumberedEvent[],
  grouped: ReadonlySet<string>,
  release: number,
): Plan | null => {
  let plans = new Map<number, Plan>([
    [0, { choices: [], totalRelease: 0, totalLevel: 0, changed: 0 }],
  ]);
  for (const event of events) {
    const duration = calculateRhythmTicks(event.rhythm);
    if (!duration.ok) return null;
    const options: Choice[] = [
      { rhythm: event.rhythm, release: 0, level: 0 },
      ...(grouped.has(event.id)
        ? []
        : getShorterRhythmOptions(event.rhythm).map((option) => ({
            rhythm: option.rhythm,
            release: duration.ticks - option.ticks,
            level: option.level,
          }))),
    ];
    const next = new Map<number, Plan>();
    for (const plan of plans.values()) {
      for (const option of options) {
        const totalRelease = plan.totalRelease + option.release;
        if (totalRelease > release) continue;
        const candidate: Plan = {
          choices: [...plan.choices, option],
          totalRelease,
          totalLevel: plan.totalLevel + option.level,
          changed: plan.changed + (option.level ? 1 : 0),
        };
        const existing = next.get(totalRelease);
        if (!existing || better(candidate, existing))
          next.set(totalRelease, candidate);
      }
    }
    plans = next;
  }
  return plans.get(release) ?? null;
};

/**
 * 规划简谱事件时值变化。
 *
 * 缩短只释放原事件尾部的可录入区间；延长则保留后续事件内容，先平移后续事件，
 * 必要时用与 TAB 相同的“精确释放量”策略缩短后续事件。这个规划器只读 voice，
 * 预览和实际提交共用同一结果。
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
    return {
      ok: false,
      code: "EVENT_IN_TUPLET",
      message: "连音成员须整组修改时值",
    };
  const previous = context.getEventDurationTicks(target);
  const next = calculateRhythmTicks(rhythm);
  if (!previous.ok || !next.ok)
    return {
      ok: false,
      code: "INVALID_RHYTHM",
      message: "简谱时值无效",
    };
  if (previous.ticks === next.ticks)
    return {
      ok: true,
      voice,
      movedEventIds: [],
      resizedEventIds: [],
    };

  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  if (next.ticks < previous.ticks) {
    const endTick = target.tick + next.ticks;
    return {
      ok: true,
      voice: {
        ...voice,
        events: events.map((event) =>
          event.id === eventId ? { ...event, rhythm: { ...rhythm } } : event,
        ),
      },
      movedEventIds: [],
      resizedEventIds: [eventId],
      releasedRange: {
        startTick: endTick,
        endTick: target.tick + previous.ticks,
      },
    };
  }

  const tail = events.slice(index + 1);
  const delta = next.ticks - previous.ticks;
  const leadingGap = tail.length
    ? tail[0]!.tick - (target.tick + previous.ticks)
    : 0;
  const shift = Math.max(0, delta - leadingGap);
  const originalEnd = tail.reduce((end, event) => {
    const duration = context.getEventDurationTicks(event);
    return duration.ok ? Math.max(end, event.tick + duration.ticks) : end;
  }, target.tick + previous.ticks);
  const overflow = Math.max(0, originalEnd + shift - capacity);
  const compression = chooseCompression(
    tail,
    new Set(context.tupletByEventId.keys()),
    overflow,
  );
  if (overflow && !compression)
    return {
      ok: false,
      code: "CANNOT_COMPRESS",
      message: "后续简谱无法压缩以容纳新的时值",
    };
  const choices =
    compression?.choices ??
    tail.map((event) => ({
      rhythm: event.rhythm,
      release: 0,
      level: 0,
    }));
  const choiceById = new Map(tail.map((event, i) => [event.id, choices[i]!]));
  const changed = new Set<string>([eventId]);
  const moved = new Set<string>();
  let previousOriginalEnd = target.tick + previous.ticks;
  let cursor = target.tick + next.ticks;
  const rebuiltTail = tail.map((event, index) => {
    const duration = context.getEventDurationTicks(event);
    if (!duration.ok) return event;
    const gap =
      index === 0
        ? Math.max(0, leadingGap - delta)
        : event.tick - previousOriginalEnd;
    const choice = choiceById.get(event.id)!;
    const nextEvent = {
      ...event,
      tick: cursor + gap,
      rhythm: { ...choice.rhythm },
    };
    if (nextEvent.tick !== event.tick) moved.add(event.id);
    if (choice.level) changed.add(event.id);
    previousOriginalEnd = event.tick + duration.ticks;
    const nextDuration = calculateRhythmTicks(choice.rhythm);
    cursor =
      nextEvent.tick +
      (choice.level && nextDuration.ok ? nextDuration.ticks : duration.ticks);
    return nextEvent;
  });
  const updatedTarget = { ...target, rhythm: { ...rhythm } };
  const updated = [
    ...events.slice(0, index),
    updatedTarget,
    ...rebuiltTail,
  ].sort((a, b) => a.tick - b.tick);
  const updatedContext = createNumberedRhythmContext({
    ...voice,
    events: updated,
  });
  const finalEnd = rebuiltTail.reduce((end, event) => {
    const d = updatedContext.getEventDurationTicks(event);
    return d.ok ? Math.max(end, event.tick + d.ticks) : end;
  }, updatedTarget.tick + next.ticks);
  if (finalEnd > capacity)
    return {
      ok: false,
      code: "TIMELINE_OVERFLOW",
      message: "简谱时值超出小节容量",
    };
  return {
    ok: true,
    voice: { ...voice, events: updated },
    movedEventIds: [...moved],
    resizedEventIds: [...changed],
  };
};
