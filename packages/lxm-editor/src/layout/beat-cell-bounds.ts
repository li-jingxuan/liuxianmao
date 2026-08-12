/**
 * Beat 水平单元格边界。
 *
 * `ILXMBeatLayout.x` 是音符、休止符和符干共同使用的时间锚点，并不是选框的
 * 左边界。选框如果直接从 `beat.x` 向右绘制，就会让目标 Beat 落在框的左侧，
 * 产生明显的向右偏移。本模块用相邻时间锚点的中点划分单元格，使 selection、
 * caret 和 hit-test 可以共享同一套水平几何语义。
 */
import type { ILXMMeasureLayout } from "./layout-types";

/** 一个 Beat 在所属小节中的最终水平单元格边界。 */
export interface ILXMBeatCellBounds {
  left: number;
  right: number;
  width: number;
}

/**
 * 计算指定 Beat 的水平单元格边界。
 *
 * 中间 Beat 使用相邻锚点的中点作为左右边界，因此等间距时 Beat 锚点正好位于
 * 单元格中央；节奏间距不相等时，这种划分仍能表达“离哪个 Beat 更近”。首尾
 * Beat 分别延伸到小节左右边界，既不会越过小节线，也不会在小节内部留下无法
 * 命中的空白区域。
 *
 * 本函数显式按最终 x 坐标排序，不依赖 `measure.beats` 当前的构造顺序。这样即使
 * 后续 layout 调整数组生成方式，只要最终坐标不变，单元格边界仍保持稳定。
 */
export const getBeatCellBounds = (
  measure: ILXMMeasureLayout,
  beatId: string,
): ILXMBeatCellBounds | null => {
  const orderedBeats = [...measure.beats].sort(
    (left, right) => left.x - right.x,
  );
  const index = orderedBeats.findIndex((beat) => beat.id === beatId);
  const current = orderedBeats[index];
  if (!current) return null;

  const previous = orderedBeats[index - 1];
  const next = orderedBeats[index + 1];

  // 公共边界取两个时间锚点的中点。第一个和最后一个 Beat 没有外侧邻居，
  // 因而分别使用 measure 的真实左右边界，保证命中区域完整覆盖整个小节。
  const left = previous ? (previous.x + current.x) / 2 : measure.x;
  const right = next ? (current.x + next.x) / 2 : measure.x + measure.width;
  const width = right - left;

  // 正常 layout 一定会得到有限的正宽度。这里保留防御性守卫，避免未来异常坐标
  // 被继续传给 SVG，最终产生难以定位的 NaN、Infinity 或负宽度渲染问题。
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(width) ||
    width <= 0
  ) {
    return null;
  }

  return { left, right, width };
};
