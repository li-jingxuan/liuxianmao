import type { BeadGrid } from "./types";

/**
 * 统计主体实际需要制作的拼豆数量；null 表示背景或空格，不计入统计。
 * 背景是独立渲染层，因此这里无需再维护逐格 background mask。
 */
export const countForegroundBeads = (grid: BeadGrid): number =>
  grid.foreground.rows.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );

/** 页面和导出共用的兼容命名，语义已经从“非透明格”收紧为“主体豆”。 */
export const countOccupiedBeads = countForegroundBeads;
