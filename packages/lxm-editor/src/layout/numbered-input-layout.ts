import { planNumberedInputRanges } from "../core/numbered-input-ranges";
import type {
  ILXMMeasure,
  ILXMNumberedTarget,
  ILXMRhythm,
} from "../core/types";
import type { ILXMMeasureLayout } from "./layout-types";
import type { MusicTextRect } from "./music-text-metrics";

export interface NumberedInputSlot extends MusicTextRect {
  key: string;
  anchorX: number;
  startTick: number;
  endTick: number;
  rhythm?: ILXMRhythm;
  target: ILXMNumberedTarget;
}

/** 占位与临时窗口共用联合时间插值；正式音符仍以真实时间列为准。 */
export const numberedXAtTick = (
  measure: ILXMMeasureLayout,
  tick: number,
): number => {
  const anchors = measure.timeAnchors;
  const exact = anchors.find((a) => a.tick === tick);
  if (exact) return exact.x;
  const next = anchors.findIndex((a) => a.tick > tick);
  const left = anchors[Math.max(0, next - 1)]!,
    right = anchors[next];
  return right
    ? left.x +
        ((right.x - left.x) * (tick - left.tick)) / (right.tick - left.tick)
    : left.x;
};

/** 最终谱行位置确定后只生成一份空位几何，竖向范围使用数字正文带。 */
export const layoutNumberedInputSlots = (
  trackId: string,
  source: ILXMMeasure,
  measure: ILXMMeasureLayout,
  band: { y: number; height: number },
): NumberedInputSlot[] =>
  planNumberedInputRanges(source).map((range) => {
    const anchorX = numberedXAtTick(measure, range.startTick);
    const endX = numberedXAtTick(measure, range.endTick);
    const available = Math.max(2, endX - anchorX);
    const width = Math.min(24, Math.max(2, available - 4));
    return {
      ...range,
      key: `${source.id}/${range.eventId ?? range.startTick}/${range.endTick}`,
      anchorX,
      x: anchorX - width / 2,
      y: band.y,
      width,
      height: band.height,
      target: range.eventId
        ? {
            kind: "numberedEvent",
            trackId,
            measureId: source.id,
            eventId: range.eventId,
          }
        : {
            kind: "numberedTime",
            trackId,
            measureId: source.id,
            tick: range.startTick,
            endTick: range.endTick,
          },
    };
  });
