import { calculateRhythmTicks, getMeasureCapacityTicks } from "../rhythm/rhythm";
import type { ILXMMeasure, ILXMNumberedEvent, ILXMRhythm, ILXMTrack, ILXMTupletRatio } from "../types";
import { planNumberedInputRanges, type NumberedInputRange } from "./numbered-input-ranges";
import { validNumberedTokens, type NumberedSequenceItem } from "./numbered-notation";
import { createNumberedRhythmContext } from "./numbered-rhythm";

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
export type NumberedSequenceOverwritePlan =
  | { ok: true; targets: NumberedSequenceTarget[]; removedEventIds: string[]; availableTicks: number }
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
  if (!measure || startTick === undefined || !Number.isInteger(startTick) || startTick < 0 || startTick >= getMeasureCapacityTicks(measure.timeSignature) ||
    !input.items.length || input.items.length > 256 || (input.rhythms && input.rhythms.length !== input.items.length))
    return fail("简谱起点、输入数量或模板无效，整批未应用");
  const targets: NumberedSequenceTarget[] = [];
  let cursor: number = startTick;
  const removedEventIds: string[] = [];
  let measureIndex = firstMeasure;
  for (const [index, item] of input.items.entries()) {
    let current = track.measures[measureIndex];
    if (current && cursor === getMeasureCapacityTicks(current.timeSignature)) {
      current = track.measures[++measureIndex];
      cursor = 0;
    }
    if (!current) return fail("简谱目标不足，整批未应用");
    if (item.kind === "set" && item.tokens.length && !validNumberedTokens(item.tokens)) return fail("简谱内容无效");
    const context = createNumberedRhythmContext(current.numberedVoice);
    const slots = planNumberedSequenceSlots(current);
    const slot = slots.find(slot => slot.startTick === cursor);
    const rhythm = input.rhythms?.[index] ?? slot?.rhythm;
    if (!rhythm) return fail("当前位置没有可用的简谱时间槽");
    const event = current.numberedVoice.events.find(event => event.tick === cursor);
    const group = event && context.tupletByEventId.get(event.id);
    const duration = calculateRhythmTicks(rhythm);
    if (!duration.ok) return fail("简谱时值无效");
    // Default targets carry actual tuplet duration, not their unscaled written value.
    const ticks = input.rhythms ? duration.ticks : slot!.endTick - cursor;
    const endTick = cursor + ticks;
    if (ticks <= 0 || endTick > getMeasureCapacityTicks(current.timeSignature)) return fail("输入时值超出小节边界，整批未应用");
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
      if (event.tick >= end || event.tick + duration.ticks <= start) continue;
      if (event.tick < start || (event.tick + duration.ticks > end && event.tick !== start)) return fail("范围不能切断已有事件");
      const target = planned.find(target => target.eventId === event.id);
      if (context.tupletByEventId.has(event.id) && (!target || target.endTick !== event.tick + duration.ticks)) return fail("范围不能改变或切断连音组");
      if (!target) {
        if (current.lyrics.some(lyric => lyric.eventId === event.id) || track.numberedMarks.some(mark => mark.type === "slur" && (mark.fromEventId === event.id || mark.toEventId === event.id)))
          return fail("新节奏无法保留已有歌词或连线的归属，请调整输入时值");
        removedEventIds.push(event.id);
      }
      const sameContent = target?.item.kind === "skip" || (target?.item.kind === "set" && JSON.stringify(target.item.tokens) === JSON.stringify(event.items.map(item => item.token)));
      if (!input.allowOverwrite && event.items.length && (!sameContent || !target || JSON.stringify(event.rhythm) !== JSON.stringify(target.rhythm))) return fail("请确认允许覆盖已有简谱");
    }
  }
  return { ok: true, targets, removedEventIds, availableTicks: track.measures.slice(firstMeasure).reduce((sum, measure) => sum + getMeasureCapacityTicks(measure.timeSignature), 0) - startTick };
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
