import type { ColorSetsResponse, ConversionInput, BeadGrid } from "./types";

type ApiErrorBody = { error?: { code?: string; message?: string; request_id?: string } };

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

/**
 * 集中解析所有 API 响应，确保列表请求和转换请求采用一致的错误策略。
 * 后端非 2xx 响应可能因代理或网关异常而不是 JSON，因此 JSON 解析失败时
 * 会安全降级为通用提示，而不会把 SyntaxError 泄漏给用户。
 */
const parseResponse = async <T>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new PindouApiError(error?.message ?? "请求失败，请稍后重试", error?.code, error?.request_id);
  }
  return body as T;
};

/** 加载后端实际可用的 MARD 颜色组，前端不维护重复的硬编码列表。 */
export const getColorSets = async (signal?: AbortSignal): Promise<ColorSetsResponse> => {
  const response = await fetch("/api/v1/color-sets", { signal });
  return parseResponse<ColorSetsResponse>(response);
};

/**
 * 把转换参数序列化为 FastAPI 接受的 multipart/form-data。
 * 不手动设置 Content-Type，让浏览器自动补上包含 boundary 的请求头。
 */
export const createConversion = async (input: ConversionInput, signal?: AbortSignal): Promise<BeadGrid> => {
  const form = new FormData();
  form.set("image", input.image);
  form.set("grid_size", String(input.gridSize));
  form.set("max_colors", String(input.maxColors));
  form.set("color_set_size", String(input.colorSetSize));
  form.set("background_mode", input.backgroundMode);
  // background_color 只在纯色模式发送，避免后端误读其他模式下的陈旧色值。
  if (input.backgroundMode === "solid" && input.backgroundColor) {
    form.set("background_color", input.backgroundColor);
  }

  const response = await fetch("/api/v1/conversions", { method: "POST", body: form, signal });
  return parseResponse<BeadGrid>(response);
};
