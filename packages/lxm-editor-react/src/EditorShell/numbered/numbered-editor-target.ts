import {
  createNumberedTrackRhythmContext,
  getMeasureDurationTicks,
  planNumberedInputRanges,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
/** 编辑器按真实简谱事件／时间窗口定位，不能用 TAB beatId 合并不同音。 */
export const numberedTargetKey = (target: ILXMNumberedTarget): string =>
  `${target.trackId}/${target.measureId}/${
    target.kind === "numberedEvent"
      ? `event/${target.eventId}/${target.itemId ?? ""}`
      : `time/${target.tick}/${target.endTick}`
  }`;
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
  const track = document.score.tracks.find((t) => t.id === target.trackId);
  if (!track) return null;
  const measure = track.measures.find((m) => m.id === target.measureId);
  if (!measure) return null;
  const context = createNumberedTrackRhythmContext(track);
  const incomingEnd = context.incomingSustainEndTickByMeasureId.get(measure.id) ?? 0;
  // TAB 入口以当前简谱声部为准；区间采用半开边界，避免末端误选前音。
  const resolveTick = (tick: number): ILXMNumberedTarget | null => {
    const existing = measure.numberedVoice.events.find((event) => {
      const duration = context.getEventDurationTicks(event);
      return duration.ok && event.tick <= tick && tick < event.tick + duration.ticks;
    });
    if (existing)
      return {
        kind: "numberedEvent",
        trackId: target.trackId,
        measureId: measure.id,
        eventId: existing.id,
        itemId: existing.items[0]?.id,
      };
    const range = planNumberedInputRanges(measure, 0, context).find(
      (item) => item.startTick === tick,
    );
    // 不为缺少可靠节奏映射的 TAB 连音内部位置伪造普通录入窗口。
    return range?.rhythm
      ? {
          kind: "numberedTime",
          trackId: target.trackId,
          measureId: measure.id,
          tick: range.startTick,
          endTick: range.endTick,
        }
      : null;
  };
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
          itemId:
            "itemId" in target && target.itemId
              ? target.itemId
              : measure.numberedVoice.events.find(
                  (e) => e.id === target.eventId,
                )!.items[0]?.id,
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
      target.tick >= incomingEnd &&
      target.tick < target.endTick &&
      target.endTick <= getMeasureDurationTicks(measure)
      ? {
          // 显式范围还用于高级替换，必须保留范围身份；占用检查由操作规划完成。
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
  return resolveTick(beat.tick);
};
/** 已有事件窗口读取自身比例，不能退回 TAB 四分音时值。 */
export const numberedTargetWindow = (
  document: ILXMDocument,
  target: ILXMNumberedTarget,
) => {
  const track = document.score.tracks.find((t) => t.id === target.trackId)!;
  const measure = track.measures.find((m) => m.id === target.measureId)!;
  if (target.kind === "numberedTime")
    return { start: target.tick, end: target.endTick };
  const event = measure.numberedVoice.events.find(
    (e) => e.id === target.eventId,
  )!;
  const d = createNumberedTrackRhythmContext(track).getEventDurationTicks(event);
  return { start: event.tick, end: event.tick + (d.ok ? d.ticks : 0) };
};
