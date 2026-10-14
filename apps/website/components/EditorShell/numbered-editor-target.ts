import {
  createMeasureRhythmContext,
  createNumberedRhythmContext,
  getMeasureCapacityTicks,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
/** 用当前拍号单位显示位置，连音起点使用分数，避免三连音出现循环小数。 */
export const formatNumberedBeatPosition = (
  tick: number,
  denominator: number,
): string => {
  const unit = 3840 / denominator,
    beat = Math.floor(tick / unit) + 1,
    remainder = tick % unit;
  if (!remainder) return `第${beat}拍`;
  let divisor = remainder,
    other = unit;
  while (other) {
    const next = divisor % other;
    divisor = other;
    other = next;
  }
  return `第${beat}拍 + ${remainder / divisor}/${unit / divisor}`;
};
/** TAB 入口只转换一次临时时间窗口，后续事件选择不再绑定 TAB ID。 */
export const resolveNumberedEditorTarget = (
  document: ILXMDocument,
  target: MusicTextTarget | ILXMTabCellReference | ILXMNumberedTarget | null,
): ILXMNumberedTarget | null => {
  if (!target) return null;
  const measure = document.score.tracks
    .find((t) => t.id === target.trackId)
    ?.measures.find((m) => m.id === target.measureId);
  if (!measure) return null;
  if ("eventId" in target && target.eventId)
    return measure.numberedVoice.events.some(
      (e) =>
        e.id === target.eventId &&
        (!("itemId" in target) ||
          !target.itemId ||
          e.items.some((i) => i.id === target.itemId)),
    )
      ? {
          kind: "numberedEvent",
          trackId: target.trackId,
          measureId: target.measureId,
          eventId: target.eventId,
          ...("itemId" in target && target.itemId
            ? { itemId: target.itemId }
            : {}),
        }
      : null;
  if (
    "tick" in target &&
    target.tick !== undefined &&
    "endTick" in target &&
    target.endTick !== undefined
  )
    return Number.isInteger(target.tick) &&
      Number.isInteger(target.endTick) &&
      target.tick >= 0 &&
      target.tick < target.endTick &&
      target.endTick <= getMeasureCapacityTicks(measure.timeSignature)
      ? {
          kind: "numberedTime",
          trackId: target.trackId,
          measureId: target.measureId,
          tick: target.tick,
          endTick: target.endTick,
        }
      : null;
  const beat =
    "beatId" in target
      ? measure.beats.find((b) => b.id === target.beatId)
      : undefined;
  if (!beat) return null;
  const existing = measure.numberedVoice.events.find(
    (e) => e.tick === beat.tick,
  );
  if (existing)
    return {
      kind: "numberedEvent",
      trackId: target.trackId,
      measureId: measure.id,
      eventId: existing.id,
    };
  const duration =
    createMeasureRhythmContext(measure).getBeatDurationTicks(beat);
  return duration.ok
    ? {
        kind: "numberedTime",
        trackId: target.trackId,
        measureId: measure.id,
        tick: beat.tick,
        endTick: beat.tick + duration.ticks,
      }
    : null;
};
/** 已有事件窗口读取自身比例，不能退回 TAB 四分音时值。 */
export const numberedTargetWindow = (
  document: ILXMDocument,
  target: ILXMNumberedTarget,
) => {
  const measure = document.score.tracks
    .find((t) => t.id === target.trackId)!
    .measures.find((m) => m.id === target.measureId)!;
  if (target.kind === "numberedTime")
    return { start: target.tick, end: target.endTick };
  const event = measure.numberedVoice.events.find(
    (e) => e.id === target.eventId,
  )!;
  const d = createNumberedRhythmContext(
    measure.numberedVoice,
  ).getEventDurationTicks(event);
  return { start: event.tick, end: event.tick + (d.ok ? d.ticks : 0) };
};
