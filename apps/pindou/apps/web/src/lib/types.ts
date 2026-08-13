/** 后端支持的背景处理方式，与 FastAPI 的 BackgroundMode 枚举保持一致。 */
export type BackgroundMode = "transparent" | "solid" | "keep";

/**
 * 单个 MARD 拼豆颜色。
 * `id` 同时也是 rows 矩阵中的调色板索引，前端不能自行重排该数组。
 */
export type PaletteColor = {
  id: number;
  brand: "MARD";
  code: string;
  hex: `#${string}`;
  rgb: [number, number, number];
};

/**
 * 一次转换的完整网格结果。
 *
 * 坐标约定：`rows[y][x]` 表示第 y 行、第 x 列；值为 -1 时该格透明，
 * 其余值必须是 palette 的合法索引。预览和导出均直接消费此结构，避免
 * 前端二次量化造成颜色不一致。
 */
export type BeadGrid = {
  schema_version: "1";
  algorithm_version: string;
  width: number;
  height: number;
  palette: PaletteColor[];
  rows: number[][];
  meta: {
    enhancer: "passthrough";
    palette_brand: "MARD";
    color_set_size: number;
    color_chart_version: string;
    actual_color_count: number;
  };
};

/** GET /api/v1/color-sets 的响应，用于动态生成颜色组选项。 */
export type ColorSetsResponse = {
  brand: "MARD";
  schema_version: string;
  default_size: number;
  sets: Array<{ size: number; label: string; color_count: number }>;
};

/** 创建转换请求时，UI 状态到 multipart/form-data 字段的类型化中间结构。 */
export type ConversionInput = {
  image: File;
  gridSize: number;
  maxColors: number;
  colorSetSize: number;
  backgroundMode: BackgroundMode;
  backgroundColor?: string;
};
