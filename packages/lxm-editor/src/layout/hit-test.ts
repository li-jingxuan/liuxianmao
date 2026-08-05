/**
 * SVG 逻辑坐标命中模块。
 *
 * 命中计算只依赖 layout 产物，避免页面根据数组下标或 CSS 尺寸重新猜测业务位置。
 */

import { getBeatCellBounds } from "./beat-cell-bounds";
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

  // 命中和选框必须共享完全相同的 Beat 单元格边界。如果两处分别推导中点，后续
  // 修改其中一处时很容易再次出现“点击属于 A Beat，但高亮画在 B 区域”的偏差。
  // 这里仍按 x 排序后使用 find；公共边界点会稳定归入顺序靠前的 Beat，与修复前
  // 的右边界包含规则保持一致。
  const beatsByX = [...measure.beats].sort((left, right) => left.x - right.x);
  const beat = beatsByX.find((item) => {
    const cellBounds = getBeatCellBounds(measure, item.id);
    return (
      cellBounds !== null &&
      point.x >= cellBounds.left &&
      point.x <= cellBounds.right
    );
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
