import type { BeadGrid } from "./types";

/** 透明格是空位，不需要放豆；所有界面和导出共用这一计数规则。 */
export const countOccupiedBeads = (grid: BeadGrid) =>
  grid.rows.reduce(
    (total, row) => total + row.filter((paletteIndex) => paletteIndex !== -1).length,
    0,
  );
