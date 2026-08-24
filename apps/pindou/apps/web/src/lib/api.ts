import type {
  AccessKeyCreateInput,
  AccessKeyCreateResponse,
  AccessKeyQuotaResponse,
  BeadGrid,
  ColorCatalogResponse,
  ColorSetsResponse,
  ConversionInput,
  ConversionResult,
  ImageDeliveryResponse,
} from "./types";

type ApiErrorBody = { error?: { code?: string; message?: string; request_id?: string } };
type ApiRequestOptions = { apiKey?: string; signal?: AbortSignal };
type AdminApiRequestOptions = { adminApiKey: string; signal?: AbortSignal };

// Web 端统一访问公网 API，仍允许通过环境变量覆盖以便联调。
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://tppixel-api.cpolar.top";
/**
 * 保留后端稳定错误码和 request id 的业务异常。
 * UI 默认展示 message；排查线上问题时可进一步记录 code 和 requestId。
 */
export class PindouApiError extends Error {
  constructor(
    message: string,
    readonly code = "UNKNOWN_ERROR",
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "PindouApiError";
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  AI_INPUT_REJECTED: "图片未通过 AI 内容安全检查，请更换图片后重试",
  AI_OUTPUT_REJECTED: "AI 生成结果未通过内容安全检查，请调整素材后重试",
  AI_BUSY: "AI 服务忙，请稍后重试",
  AI_TIMEOUT: "AI 处理超时，本次未确认成功，请稍后手动重试",
  AI_UPSTREAM_ERROR: "AI 服务暂时不可用，请稍后重试",
  AI_TRANSPARENT_BACKGROUND_UNSUPPORTED: "AI 未返回透明背景，请稍后重试",
  BACKGROUND_COLOR_INVALID: "纯色背景颜色无效，请重新选择",
  API_KEY_INVALID: "当前访问链接无效",
  API_KEY_INVALID_OR_EXHAUSTED: "当前访问链接无效或转换次数已用完",
  ADMIN_API_KEY_INVALID: "当前链接没有图纸上传权限",
  DELIVERY_IMAGE_INVALID: "生成的图纸格式无效，请重新导出",
  DELIVERY_IMAGE_TOO_LARGE: "图纸尺寸过大，请降低网格尺寸后重试",
  DELIVERY_STORAGE_UNAVAILABLE: "图纸存储暂时不可用，请稍后重试",
  DELIVERY_IMAGE_NOT_FOUND: "图纸链接不存在或已过期",
};

/**
 * 集中解析所有 API 响应，确保列表请求和转换请求采用一致的错误策略。
 * 后端非 2xx 响应可能因代理或网关异常而不是 JSON，因此 JSON 解析失败时
 * 会安全降级为通用提示，而不会把 SyntaxError 泄漏给用户。
 */
const parseResponse = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    const code = error?.code ?? "UNKNOWN_ERROR";
    throw new PindouApiError(ERROR_MESSAGES[code] ?? error?.message ?? "请求失败，请稍后重试", code, error?.request_id);
  }
  return body as T;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** 校验只读额度响应，避免异常缓存或代理数据把按钮错误地置为可用。 */
const parseAccessKeyQuota = (value: unknown): AccessKeyQuotaResponse => {
  if (!isRecord(value)) throw new Error("额度响应格式无效");
  const initialUses = value.initial_uses;
  const remainingUses = value.remaining_uses;
  if (
    typeof initialUses !== "number" ||
    typeof remainingUses !== "number" ||
    !Number.isSafeInteger(initialUses) ||
    !Number.isSafeInteger(remainingUses) ||
    initialUses < 1 ||
    remainingUses < 0 ||
    remainingUses > initialUses
  ) {
    throw new Error("额度响应格式无效");
  }
  return { initial_uses: initialUses, remaining_uses: remainingUses };
};

/**
 * 校验新版前景/背景分层响应，避免错误索引在 Canvas 中被静默忽略。
 * 后端已经有 Pydantic 校验，浏览器侧仍保留这一层是为了防止代理或缓存返回旧结构。
 */
const parseBeadGrid = (value: unknown): BeadGrid => {
  if (!isRecord(value)) throw new Error("转换响应格式无效");

  // 允许灰度发布期间仍在返回旧契约的 API 先完成请求。新契约只要出现任一
  // 分层字段就必须走下面的完整校验，避免把明显损坏的新版响应静默交给 Canvas。
  // 旧版响应的结构由旧前端负责消费；这里保留透传是为了兼容滚动发布。
  if (
    !("schema_version" in value) &&
    !("foreground" in value) &&
    !("background" in value) &&
    !("stats" in value)
  ) {
    return value as unknown as BeadGrid;
  }

  const foreground = value.foreground;
  const background = value.background;
  const stats = value.stats;
  const width = value.width;
  const height = value.height;

  if (
    value.schema_version !== "3" ||
    value.algorithm_version !== "bead-grid-constrained-v2" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    !isRecord(foreground) ||
    !Array.isArray(foreground.palette) ||
    !Array.isArray(foreground.rows) ||
    !isRecord(background) ||
    !isRecord(stats)
  ) {
    throw new Error("转换响应格式无效");
  }

  if (foreground.rows.length !== height) {
    throw new Error("转换响应网格行数无效");
  }
  const paletteLength = foreground.palette.length;
  const beadCount = foreground.rows.reduce((total, row) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error("转换响应网格列数无效");
    }
    return total + row.filter((cell) => cell !== null).length;
  }, 0);
  for (const row of foreground.rows) {
    for (const cell of row) {
      if (cell !== null && (!Number.isInteger(cell) || cell < 0 || cell >= paletteLength)) {
        throw new Error("转换响应包含非法颜色索引");
      }
    }
  }
  if (
    (background.mode !== "solid" && background.mode !== "none") ||
    (background.mode === "solid" &&
      (typeof background.color !== "string" || !/^#[0-9A-F]{6}$/.test(background.color))) ||
    stats.bead_count !== beadCount ||
    stats.color_count !== paletteLength
  ) {
    throw new Error("转换响应统计或背景字段无效");
  }
  return value as unknown as BeadGrid;
};

/** 加载后端实际可用的 MARD 颜色组，前端不维护重复的硬编码列表。 */
export const getColorSets = async (signal?: AbortSignal): Promise<ColorSetsResponse> => {
  const response = await fetch(`${BASE_URL}/api/v1/color-sets`, { signal });
  return parseResponse<ColorSetsResponse>(response);
};

/** 加载按色号系列分组的完整 MARD 色卡。 */
export const getColorCatalog = async (
  signal?: AbortSignal,
): Promise<ColorCatalogResponse> => {
  const response = await fetch(`${BASE_URL}/api/v1/colors`, { signal });
  return parseResponse<ColorCatalogResponse>(response);
};

/**
 * 把转换参数序列化为 FastAPI 接受的 multipart/form-data。
 * 不手动设置 Content-Type，让浏览器自动补上包含 boundary 的请求头。
 */
export const createConversion = async (
  input: ConversionInput,
  { apiKey, signal }: ApiRequestOptions = {},
): Promise<ConversionResult> => {
  const form = new FormData();
  form.set("image", input.image);
  form.set("grid_size", String(input.gridSize));
  form.set("color_set_size", String(input.colorSetSize));
  form.set("background_mode", input.backgroundMode);
  if (input.backgroundMode === "solid" && input.backgroundColor) {
    form.set("background_color", input.backgroundColor);
  }

  const headers = apiKey ? { "X-API-Key": apiKey } : undefined;
  const response = await fetch(`${BASE_URL}/api/v1/conversions`, {
    method: "POST",
    body: form,
    headers,
    signal,
  });
  const payload = await parseResponse<unknown>(response);
  const limit = Number(response.headers.get("X-RateLimit-Limit"));
  const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
  const hasValidQuota =
    Number.isSafeInteger(limit) &&
    Number.isSafeInteger(remaining) &&
    limit >= 1 &&
    remaining >= 0 &&
    remaining <= limit;
  return {
    grid: parseBeadGrid(payload),
    quota: hasValidQuota
      ? { initial_uses: limit, remaining_uses: remaining }
      : null,
  };
};

/** 查询当前消费密钥额度；该请求只读，不会扣减转换次数。 */
export const getAccessKeyQuota = async (
  apiKey: string,
  signal?: AbortSignal,
): Promise<AccessKeyQuotaResponse> => {
  const response = await fetch(`${BASE_URL}/api/v1/access-keys/quota`, {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
    signal,
  });
  return parseAccessKeyQuota(await parseResponse<unknown>(response));
};

/** 使用管理密钥为路由中的来源前缀签发消费密钥。 */
export const createAccessKey = async (
  input: AccessKeyCreateInput,
  { adminApiKey, signal }: AdminApiRequestOptions,
): Promise<AccessKeyCreateResponse> => {
  const response = await fetch(`${BASE_URL}/api/v1/access-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-API-Key": adminApiKey,
    },
    body: JSON.stringify({
      prefix: input.prefix,
      allowed_uses: input.allowedUses,
    }),
    signal,
  });
  return parseResponse<AccessKeyCreateResponse>(response);
};

/** 使用固定管理密钥上传完整 PNG，上传属于交付动作，不消耗转换次数。 */
export const createImageDelivery = async (
  blob: Blob,
  { adminApiKey, signal }: AdminApiRequestOptions,
): Promise<ImageDeliveryResponse> => {
  const form = new FormData();
  form.set("file", blob, "pindou-pattern.png");
  const response = await fetch(`${BASE_URL}/api/v1/image-deliveries`, {
    method: "POST",
    headers: { "X-Admin-API-Key": adminApiKey },
    body: form,
    signal,
  });
  return parseResponse<ImageDeliveryResponse>(response);
};

/** 公开预览页按 token 查询原图地址和服务端计算的过期时间。 */
export const getImageDelivery = async (
  token: string,
  signal?: AbortSignal,
): Promise<ImageDeliveryResponse> => {
  const response = await fetch(
    `${BASE_URL}/api/v1/image-deliveries/${encodeURIComponent(token)}`,
    { cache: "no-store", signal },
  );
  return parseResponse<ImageDeliveryResponse>(response);
};

/** 把 API 返回的相对路径转换成浏览器可直接加载的完整地址。 */
export const resolveApiUrl = (path: string): string =>
  new URL(path, `${BASE_URL.replace(/\/$/, "")}/`).toString();
