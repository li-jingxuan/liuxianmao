/** 后端支持的背景处理方式，与 FastAPI 的 BackgroundMode 枚举保持一致。 */
export type BackgroundMode = "simplify" | "solid" | "keep";
export type ForegroundFallbackMode = "none" | "simplify";
export type ConversionStyle =
  | "original"
  | "chibi"
  | "sticker"
  | "minimal_illustration"
  | "paper_cut";

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
  schema_version: "4";
  algorithm_version: "bead-grid-constrained-v3";
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
    conversion_style: ConversionStyle;
    background_mode: BackgroundMode;
    applied_background_mode: BackgroundMode;
    background_color?: `#${string}`;
    // 后端实际采用且已经通过可信度验证的背景分离路径。
    background_processing: "none" | "local_matte" | "fallback_simplify";
    foreground_model_version?: string;
    degraded: boolean;
    degrade_reason?: "foreground_low_confidence";
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
  conversionStyle: ConversionStyle;
  fallbackMode?: ForegroundFallbackMode;
};

/** 当前消费密钥的只读额度。 */
export type AccessKeyQuotaResponse = {
  initial_uses: number;
  remaining_uses: number;
};

/** 转换网格与响应头中携带的即时额度。 */
export type ConversionResult = {
  grid: BeadGrid;
  quota: AccessKeyQuotaResponse | null;
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

/** 管理员上传图纸及公开预览页查询共用的临时交付契约。 */
export type ImageDeliveryResponse = {
  token: string;
  image_url: string;
  download_url: string;
  expires_at: string;
};
