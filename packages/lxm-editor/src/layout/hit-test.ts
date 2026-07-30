/**
 * SVG 逻辑坐标命中模块。
 *
 * 命中计算只依赖 layout 产物，避免页面根据数组下标或 CSS 尺寸重新猜测业务位置。
 */

import { LXM_STRING_HIT_RADIUS_Y } from "./layout-constants";
import type {
  ILXMHitIndex,
  ILXMHitTarget,
  ILXMLayout,
  ILXMMeasureHitBounds,
  ILXMSystemLayout,
} from "./layout-types";

/** SVG 中待命中的逻辑坐标点。 */
export interface ILXMLayoutPoint {
  x: number;
  y: number;
}

/** 从所有谱面行汇总小节矩形边界，供命中时快速过滤。 */
export const buildHitIndex = (
  trackId: string,
  systems: ILXMSystemLayout[],
): ILXMHitIndex => ({
  measureBounds: systems.flatMap((system) =>
    system.measures.map<ILXMMeasureHitBounds>((measure) => ({
      trackId,
      systemIndex: system.index,
      measureId: measure.id,
      x: measure.x,
      y: measure.y,
      width: measure.width,
      height: measure.height,
    })),
  ),
});

/** 判断点是否落在小节的可见矩形内，边界点属于该小节。 */
const isPointInBounds = (
  point: ILXMLayoutPoint,
  bounds: ILXMMeasureHitBounds,
) =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;

/**
 * 将逻辑坐标转换为稳定编辑目标。
 *
 * 关键算法：先按小节边界过滤，再使用 beat slot 的水平列范围和弦线容错范围
 * 判断。这样小节换行只影响坐标，不会改变返回的 measureId / beatId / string。
 */
export const hitTestLayout = (
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
): ILXMHitTarget | null => {
  // 判断是否在小节内
  const bounds = layout.hitIndex.measureBounds.find((item) =>
    isPointInBounds(point, item),
  );
  if (!bounds) return null;

  const system = layout.systems[bounds.systemIndex];
  // 找到命中的小节
  const measure = system?.measures.find((item) => item.id === bounds.measureId);
  if (!measure) return null;

  // beat.x 是节奏列的起点而不是音符中心。相邻 beat 以两个起点的中点作为
  // 分界，可以稳定地选择离点击位置最近的一拍。首拍向左覆盖到小节起点，末拍
  // 向右覆盖到小节终点；否则 System 拉伸后，最后一列的后半段会形成很大的
  // 无法点击区域。beats 当前由 spacing 按 x 顺序生成，这里仍显式排序，避免
  // 后续调用方改变数组构造方式时悄悄破坏命中逻辑。
  const beatsByX = [...measure.beats].sort((left, right) => left.x - right.x);
  const beat = beatsByX.find((item, index) => {
    const nextBeat = beatsByX[index + 1];
    const rightBoundary = nextBeat
      ? (item.x + nextBeat.x) / 2
      : measure.x + measure.width;

    return point.x <= rightBoundary;
  });
  if (!beat) return null;

  const string = measure.strings.find(
    (item) => Math.abs(point.y - item.y1) <= LXM_STRING_HIT_RADIUS_Y,
  );
  if (!string) return null;

  return {
    trackId: layout.trackId,
    systemIndex: bounds.systemIndex,
    measureId: measure.id,
    beatId: beat.id,
    string: string.index,
  };
};
