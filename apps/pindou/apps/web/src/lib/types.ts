/** 后端支持的背景处理方式，与 FastAPI 的 BackgroundMode 枚举保持一致。 */
export type BackgroundMode = "simplify" | "solid" | "keep";

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
  schema_version: "3";
  algorithm_version: "bead-grid-constrained-v2";
  width: number;
  height: number;
  foreground: {
    palette: PaletteColor[];
    // null 表示不放主体豆，背景由独立渲染层铺设。
    rows: Array<Array<number | null>>;
  };
  background:
    | { mode: "solid"; color: `#${string}` }
    | { mode: "none" };
  meta: {
    enhancer: "passthrough" | "seedream-5-lite";
    enhancer_model?: string;
    enhancer_prompt_version?: string;
    background_mode: BackgroundMode;
    background_color?: `#${string}`;
    // 后端实际采用的背景分离路径；旧响应可能没有此字段，因此保持可选兼容性。
    background_processing?: "none" | "native_alpha" | "edge_flood_fill";
    palette_brand: "MARD";
    color_set_size: number;
    color_budget_mode: "auto" | "legacy-explicit";
    color_budget_policy_version: string;
    effective_max_colors: number;
    color_chart_version: string;
    actual_color_count: number;
  };
  stats: {
    bead_count: number;
    color_count: number;
  };
};

/** GET /api/v1/color-sets 的响应，用于动态生成颜色组选项。 */
export type ColorSetsResponse = {
  brand: "MARD";
  schema_version: string;
  default_size: number;
  sets: Array<{ size: number; label: string; color_count: number }>;
};

/** GET /api/v1/colors 返回的完整 MARD 色卡目录。 */
export type CatalogColor = {
  code: string;
  hex: `#${string}`;
  rgb: [number, number, number];
};

export type ColorSeriesGroup = {
  series: string;
  label: string;
  color_count: number;
  colors: CatalogColor[];
};

export type ColorSetGroup = {
  size: number;
  label: string;
  color_count: number;
  colors: CatalogColor[];
};

export type ColorCatalogResponse = {
  brand: "MARD";
  schema_version: string;
  total_count: number;
  groups: ColorSeriesGroup[];
  sets: ColorSetGroup[];
};

/** 创建转换请求时，UI 状态到 multipart/form-data 字段的类型化中间结构。 */
export type ConversionInput = {
  image: File;
  gridSize: number;
  colorSetSize: number;
  backgroundMode: BackgroundMode;
  backgroundColor?: string;
};

/** POST /api/v1/access-keys 的签发参数。 */
export type AccessKeyCreateInput = {
  prefix: string;
  allowedUses: number;
};

/** POST /api/v1/access-keys 成功响应。 */
export type AccessKeyCreateResponse = {
  key: string;
  prefix: string;
  allowed_uses: number;
  remaining_uses: number;
  created_at: string;
};
