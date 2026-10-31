/** Web 前缀在 Next 构建阶段固化；普通部署默认使用根路径。 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// 显式配置外部 API 仅供普通部署/本地开发；NAS 镜像传空值使用同源网关。
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || BASE_PATH).replace(/\/$/, "");

/** 原生链接与分享使用此方法；Next Link 自带 basePath，无需再调用。 */
export const webPath = (path: string): string => `${BASE_PATH}${path}`;

/** API 路径始终从 /api/v1/ 开始，后端返回的文件路径也遵守相同约定。 */
export const apiPath = (path: string): string => {
  if (!/^\/api\/v1\/[A-Za-z0-9_/-]*$/.test(path)) {
    throw new Error("API 路径无效");
  }
  return `${API_BASE}${path}`;
};

export const deliveryShareUrl = (origin: string, token: string): string =>
  new URL(webPath(`/delivery/${encodeURIComponent(token)}/`), origin).toString();
