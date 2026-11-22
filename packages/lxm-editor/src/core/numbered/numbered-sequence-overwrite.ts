import { calculateRhythmTicks, getMeasureDurationTicks } from "../rhythm/rhythm";
import type { ILXMMeasure, ILXMNumberedEvent, ILXMRhythm, ILXMTrack, ILXMTupletRatio } from "../types";
import { numberedRhythmForTicks, planNumberedInputRanges, type NumberedInputRange } from "./numbered-input-ranges";
import { validNumberedTokens, type NumberedSequenceItem } from "./numbered-notation";
import {
  createNumberedRhythmContext,
  numberedContinuationIssue,
  numberedContinuationRhythm,
  NUMBERED_CONTINUATION_METER_REASON,
} from "./numbered-rhythm";

export interface NumberedSequenceTarget {
  measureId: string;
  startTick: number;
  endTick: number;
  rhythm: ILXMRhythm;
  eventId?: string;
  ratio?: ILXMTupletRatio;
  item: NumberedSequenceItem;
}
export interface NumberedSequenceOverwriteInput {
  measureId: string;
  eventId?: string;
  startTick?: number;
  items: NumberedSequenceItem[];
  /** Absent means follow each existing real or virtual target's rhythm. */
  rhythms?: ILXMRhythm[];
  allowOverwrite: boolean;
}
interface NumberedSequenceGapRemainder {
  measureId: string;
  eventId?: string;
  tick: number;
  rhythm: ILXMRhythm;
}
export type NumberedSequenceOverwritePlan =
  | { ok: true; targets: NumberedSequenceTarget[]; removedEventIds: string[]; gapRemainders: NumberedSequenceGapRemainder[]; availableTicks: number }
  | { ok: false; message: string };

/** The same real + virtual targets serve both selection backfill and writes. */
export const planNumberedSequenceSlots = (measure: ILXMMeasure): (NumberedInputRange & { ratio?: ILXMTupletRatio })[] => {
  const context = createNumberedRhythmContext(measure.numberedVoice);
  return [
    ...planNumberedInputRanges(measure),
    ...measure.numberedVoice.events.filter(event => event.kind !== "gap").map(event => {
      const duration = context.getEventDurationTicks(event);
      return { eventId: event.id, startTick: event.tick, endTick: event.tick + (duration.ok ? duration.ticks : 0), rhythm: event.rhythm };
    }),
  ].map(slot => ({ ...slot, ...(slot.eventId && context.tupletByEventId.has(slot.eventId) ? { ratio: context.tupletByEventId.get(slot.eventId)!.ratio } : {}) })).sort((a, b) => a.startTick - b.startTick);
};

/** One time-ordered plan for commit, preview, duration and focus. No IDs allocated. */
export const planNumberedSequenceOverwrite = (
  track: ILXMTrack,
  input: NumberedSequenceOverwriteInput,
): NumberedSequenceOverwritePlan => {
  const fail = (message: string): NumberedSequenceOverwritePlan => ({ ok: false, message });
  const firstMeasure = track.measures.findIndex(measure => measure.id === input.measureId);
  const measure = track.measures[firstMeasure];
  const firstEvent = measure?.numberedVoice.events.find(event => event.id === input.eventId);
  const startTick = input.eventId ? firstEvent?.tick : input.startTick;
  if (!measure || startTick === undefined || !Number.isInteger(startTick) || startTick < 0 || startTick >= getMeasureDurationTicks(measure) ||
    !input.items.length || input.items.length > 256 || (input.rhythms && input.rhythms.length !== input.items.length))
    return fail("简谱起点、输入数量或模板无效，整批未应用");
  const targets: NumberedSequenceTarget[] = [];
  let cursor: number = startTick;
  const removedEventIds: string[] = [];
  const gapRemainders: NumberedSequenceGapRemainder[] = [];
  let measureIndex = firstMeasure;
  for (const [index, item] of input.items.entries()) {
    let current = track.measures[measureIndex];
    if (current && cursor === getMeasureDurationTicks(current)) {
      current = track.measures[++measureIndex];
      cursor = 0;
    }
    if (!current) return fail("简谱目标不足，整批未应用");
    if (item.kind === "set" && item.tokens.length && !validNumberedTokens(item.tokens)) return fail("简谱内容无效");
    const context = createNumberedRhythmContext(current.numberedVoice);
    const slots = planNumberedSequenceSlots(current);
    let slot = slots.find(slot => slot.startTick === cursor);
    if (!slot && !input.rhythms) {
      const continuations = targets.filter(target => target.measureId === current.id &&
        target.item.kind === "set" && target.item.tokens[0] === "-");
      if (continuations.length) {
        // 新延音的终点可能落在原 TAB 格或被取代事件的内部。从释放的空白重新读取后续槽，
        // 避免要求用户先修改 TAB，或为了对齐旧槽而移动后续真实简谱事件。
        const events = current.numberedVoice.events.filter(event => {
          const duration = context.getEventDurationTicks(event);
          return !duration.ok || !continuations.some(target =>
            event.tick < target.endTick && event.tick + duration.ticks > target.startTick);
        });
        slot = planNumberedInputRanges({ ...current, numberedVoice: { ...current.numberedVoice, events } }, cursor)
          .find(range => range.startTick === cursor);
      }
    }
    const event = current.numberedVoice.events.find(event => event.tick === cursor);
    const group = event && context.tupletByEventId.get(event.id);
    const continuation = item.kind === "set" && item.tokens[0] === "-";
    // 重录已存在的旧延音保留原始时值。新延音覆盖模板或 TAB 推导值，并以实际占用推进批量光标。
    const existingContinuation = continuation && event?.kind === "continuation";
    const fixedContinuation = continuation && !existingContinuation;
    const fixedRhythm = fixedContinuation ? numberedContinuationRhythm(current.timeSignature) : undefined;
    if (fixedContinuation && !fixedRhythm) return fail(NUMBERED_CONTINUATION_METER_REASON);
    const rhythm = existingContinuation ? event.rhythm : fixedRhythm ?? input.rhythms?.[index] ?? slot?.rhythm;
    if (!rhythm) return fail("当前位置没有可用的简谱时间槽");
    const duration = calculateRhythmTicks(rhythm);
    if (!duration.ok) return fail("简谱时值无效");
    // Default targets carry actual tuplet duration, not their unscaled written value.
    const ticks = fixedContinuation || (input.rhythms && !existingContinuation) ? duration.ticks : slot!.endTick - cursor;
    const endTick = cursor + ticks;
    if (fixedContinuation) {
      const issue = numberedContinuationIssue(track, current, cursor, endTick, context);
      if (issue) return fail(issue);
    }
    if (ticks <= 0 || endTick > getMeasureDurationTicks(current)) return fail("输入时值超出小节边界，整批未应用");
    if (input.rhythms && group && (JSON.stringify(rhythm) !== JSON.stringify(event!.rhythm) || endTick !== slot?.endTick))
      return fail("显式节奏不能改变连音成员，请使用整组窗口编辑");
    if (item.kind === "skip" && event && endTick !== slot?.endTick) return fail("跳过项必须保留已有事件的完整时长");
    targets.push({ measureId: current.id, startTick: cursor, endTick, rhythm: { ...rhythm }, ...(event ? { eventId: event.id } : {}), ...(group ? { ratio: group.ratio } : {}), item });
    cursor = endTick;
  }
  // Explicit rhythms may subdivide the first event or replace complete following events.
  // Every surviving identity maps by its exact onset; unmappable lyrics/slurs are rejected.
  for (const current of track.measures.slice(firstMeasure, measureIndex + 1)) {
    const planned = targets.filter(target => target.measureId === current.id);
    if (!planned.length) continue;
    const start = planned[0]!.startTick, end = planned.at(-1)!.endTick;
    const context = createNumberedRhythmContext(current.numberedVoice);
    for (const event of current.numberedVoice.events) {
      const duration = context.getEventDurationTicks(event);
      if (!duration.ok) return fail("简谱目标时值无效");
      const eventEnd = event.tick + duration.ticks;
      if (event.tick >= end || eventEnd <= start) continue;
      const target = planned.find(target => target.eventId === event.id);
      const grouped = context.tupletByEventId.has(event.id);
      const hasLyric = current.lyrics.some(lyric => lyric.eventId === event.id);
      const hasSlur = track.numberedMarks.some(mark => mark.type === "slur" && (mark.fromEventId === event.id || mark.toEventId === event.id));
      if (event.kind === "gap" && (event.tick < start || eventEnd > end) && !grouped && !hasLyric && !hasSlur &&
        !track.numberedMarks.some(mark => mark.type === "fermata" && mark.eventId === event.id) &&
        !planned.some(target => target.item.kind === "skip" && target.startTick < eventEnd && target.endTick > event.tick)) {
        // 原起点若被新输入沿用，事件 ID 也由新输入沿用；否则交给首个可写的剩余空格。
        // 无法用单个时值表示的剩余区间保留为稀疏声部中的隐式空白。
        let remainingId = target ? undefined : event.id;
        for (const [tick, endTick] of [[event.tick, start], [end, eventEnd]] as const) {
          if (tick >= endTick) continue;
          const rhythm = numberedRhythmForTicks(endTick - tick);
          if (!rhythm) continue;
          gapRemainders.push({ measureId: current.id, eventId: remainingId, tick, rhythm });
          remainingId = undefined;
        }
        if (remainingId) removedEventIds.push(remainingId);
        continue;
      }
      // 延音可以缩短它明确替换的事件，即使这是批次最后一项；未被定位的后音仍不可切断。
      const replacesWithContinuation = target?.item.kind === "set" && target.item.tokens[0] === "-";
      if (event.tick < start || (eventEnd > end && event.tick !== start && !replacesWithContinuation)) return fail("范围不能切断已有事件");
      if (grouped && (!target || target.endTick !== eventEnd)) return fail("范围不能改变或切断连音组");
      if (!target) {
        if (hasLyric || hasSlur)
          return fail("新节奏无法保留已有歌词或连线的归属，请调整输入时值");
        removedEventIds.push(event.id);
      }
      const sameContent = target?.item.kind === "skip" || (target?.item.kind === "set" && JSON.stringify(target.item.tokens) === JSON.stringify(event.items.map(item => item.token)));
      if (!input.allowOverwrite && event.items.length && (!sameContent || !target || JSON.stringify(event.rhythm) !== JSON.stringify(target.rhythm))) return fail("请确认允许覆盖已有简谱");
    }
  }
  return { ok: true, targets, removedEventIds, gapRemainders, availableTicks: track.measures.slice(firstMeasure).reduce((sum, measure) => sum + getMeasureDurationTicks(measure), 0) - startTick };
};

/** Retain corresponding members so content-only edits do not discard tie endpoints. */
export const numberedSequenceContent = (
  previous: ILXMNumberedEvent | undefined,
  tokens: string[],
  createItemId: () => string,
): { kind: "gap"; items: [] } | { kind: "notes" | "rest" | "continuation"; items: { id: string; token: string }[] } =>
  !tokens.length ? { kind: "gap", items: [] } : {
    kind: tokens[0] === "0" ? "rest" : tokens[0] === "-" ? "continuation" : "notes",
    items: tokens.map((token, index) => ({ id: previous?.items[index]?.id ?? createItemId(), token })),
  };
