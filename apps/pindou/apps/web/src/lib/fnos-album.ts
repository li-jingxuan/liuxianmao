import Base64 from "crypto-js/enc-base64";
import HmacSHA256 from "crypto-js/hmac-sha256";
import MD5 from "crypto-js/md5";

import { FNOS_SESSION_BUILD, FnosSessionError, getFnosUploadSession } from "./fnos-session";

const TTL_SECONDS = 604800;
const MAX_DURATION_MS = 90_000;
const SIGN_PREFIX = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh";
const SIGN_MATERIAL = "EAECCF25-80A6-4666-A7C2-A76904A74AB6";

/** 使用与 NAS 网页相同的签名，保持签名文本与实际请求体完全一致。 */
export function albumAuthx(path: string, text: string): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const nonce = String(100000 + random[0] % 900000);
  const timestamp = String(Date.now());
  const digest = MD5(decodeURIComponent(text)).toString();
  const signature = MD5([
    SIGN_PREFIX, path, nonce, timestamp, digest, SIGN_MATERIAL,
  ].join("_")).toString();
  return `nonce=${nonce}&timestamp=${timestamp}&sign=${signature}`;
}

function sessionInvalid(): Error {
  return new Error("飞牛登录已失效，请重新登录后重试，图纸已保存在本地");
}

function invalidResponse(): Error {
  return new Error("相册服务返回了无效数据，图纸已保存在本地");
}

function positiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

type AlbumStage = "session" | "upload-path" | "upload" | "album-notice" | "share-create" | "share-detail" | "complete";
type AlbumDiagnostic = {
  version: 1;
  build: string;
  stage: AlbumStage;
  albumId: number;
  session?: string;
  httpStatus?: number;
  businessCode?: number;
  codeField?: "code" | "errno" | "errorCode";
  serverClockDifferenceSeconds?: number;
};

const STAGE_NAMES: Record<AlbumStage, string> = {
  session: "读取 App 会话", "upload-path": "查询上传目录", upload: "传输图片",
  "album-notice": "加入目标相册", "share-create": "创建分享", "share-detail": "检查分享", complete: "完成",
};

export class FnosAlbumError extends Error {
  readonly diagnostic: string;
  constructor(message: string, diagnostic: AlbumDiagnostic) {
    super(message);
    this.name = "FnosAlbumError";
    this.diagnostic = `飞牛相册诊断 v1\n${JSON.stringify(diagnostic, null, 2)}`;
  }
}

function checkPayload(value: unknown, diagnostic: AlbumDiagnostic): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResponse();
  const data = value as Record<string, unknown>;
  for (const key of ["code", "errno", "errorCode"] as const) {
    if (!(key in data)) continue;
    if (typeof data[key] === "number" && Number.isSafeInteger(data[key])) {
      diagnostic.businessCode = data[key] as number;
      diagnostic.codeField = key;
    }
    if (data[key] === 401) throw sessionInvalid();
    if (data[key] === 403) {
      throw new Error(`相册接口拒绝请求（${STAGE_NAMES[diagnostic.stage]}，错误码 403），请检查 App 登录和相册授权，图纸已保存在本地`);
    }
    if (data[key] !== 0) {
      throw new Error("相册服务请求失败，图纸已保存在本地");
    }
  }
  if (data.success === false) throw invalidResponse();
  return data;
}

/** 仅向当前 NAS 同源请求；Cookie 由浏览器携带，不读取或转发 HttpOnly 登录凭据。 */
export async function uploadAndShareAlbum(
  image: Blob,
  albumId: number,
  signal?: AbortSignal,
): Promise<{ url: string; expiresAt: string }> {
  if (!positiveInt(albumId)) throw new Error("飞牛相册尚未配置，图纸已保存在本地");
  const diagnostic: AlbumDiagnostic = { version: 1, build: FNOS_SESSION_BUILD, stage: "session", albumId };
  function stage(value: AlbumStage) {
    diagnostic.stage = value;
    delete diagnostic.httpStatus;
    delete diagnostic.businessCode;
    delete diagnostic.codeField;
    delete diagnostic.serverClockDifferenceSeconds;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_DURATION_MS);

  async function request(path: string, options: RequestInit = {}, empty = false) {
    // 所有路径由本模块固定，禁止配置项或调用方将会话签名发往其他来源。
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin) throw invalidResponse();
    controller.signal.throwIfAborted();
    const response = await fetch(url.toString(), {
      ...options,
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal,
    });
    diagnostic.httpStatus = response.status;
    const serverDate = response.headers.get("Date");
    const serverTime = serverDate ? Date.parse(serverDate) : NaN;
    if (Number.isFinite(serverTime)) diagnostic.serverClockDifferenceSeconds = Math.round((serverTime - Date.now()) / 1000);
    if (response.status === 401) throw sessionInvalid();
    if (response.status === 403) {
      throw new Error("当前用户没有相册操作权限，请检查相册授权，图纸已保存在本地");
    }
    if (!response.ok) throw new Error("相册服务请求失败，图纸已保存在本地");
    const text = await response.text();
    if (!text && empty) return {};
    if (text.length > 1024 * 1024) throw invalidResponse();
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw invalidResponse(); }
    return checkPayload(data, diagnostic);
  }

  async function api(path: string, body?: object, query = "") {
    const text = body ? JSON.stringify(body) : query;
    const payload = await request(`${path}${query ? `?${query}` : ""}`, {
      method: body ? "POST" : "GET",
      headers: {
        authx: albumAuthx(path, text),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: text } : {}),
    });
    if (payload.code !== 0) throw invalidResponse();
    const data = payload.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw invalidResponse();
    return data as Record<string, unknown>;
  }

  try {
    const { secret, token } = await getFnosUploadSession(controller.signal, (report) => { diagnostic.session = report; });
    controller.signal.throwIfAborted();
    stage("upload-path");
    const info = await api("/p/api/v2/photo/upload/path");
    const upload = info.upload as { path?: unknown; hasAccess?: unknown } | undefined;
    if (!upload || typeof upload !== "object") throw invalidResponse();
    if (upload.hasAccess !== true) {
      throw new Error("没有相册上传权限，图纸已保存在本地");
    }
    const directory = upload.path;
    if (
      typeof directory !== "string" || directory.length > 4096 ||
      !directory.startsWith("/") || directory.startsWith("//") ||
      /[\\\x00-\x1f\x7f]/.test(directory) ||
      directory.split("/").some((part) => part === "." || part === "..")
    ) throw invalidResponse();
    const random = new Uint8Array(16);
    crypto.getRandomValues(random);
    const filename = `${Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("")}.png`;
    const path = encodeURI(`${directory.replace(/\/$/, "")}/${filename}`);
    const now = Math.floor(Date.now() / 1000);
    const form = new FormData();
    form.set("trim-upload-file", image, filename);
    stage("upload");
    await request("/upload", {
      method: "POST",
      headers: {
        "Trim-Path": path,
        "Trim-Overwrite": "false",
        "Trim-Mtim": String(now),
        "Trim-Flags": "1",
        "Trim-Token": token,
        "Trim-Sign": Base64.stringify(HmacSHA256(path, Base64.parse(secret))),
      },
      body: form,
    }, true);
    stage("album-notice");
    const notice = await api("/p/api/v1/photo/upload/notice", {
      files: [{
        file_create_time: new Date(now * 1000).toISOString().slice(0, 19).replaceAll("-", ":").replace("T", " "),
        original_name: "pindou-pattern.png",
        file_name: filename,
      }],
      album_id: albumId,
    });
    const photos = notice.list;
    if (!Array.isArray(photos) || photos.length !== 1) throw invalidResponse();
    const photo = photos[0];
    // 去重返回的有效图片 ID 同样成功，不能只判断 successCount。
    if (!photo || photo.errorCode !== 0 || photo.error || !positiveInt(photo.id)) {
      throw new Error("相册入库失败，图纸已保存在本地");
    }
    const validTo = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    stage("share-create");
    let share = await api("/p/api/v1/share_link/new", {
      photoIds: [photo.id], name: "拼豆图纸", validTo,
    });
    const id = share.id;
    const url = share.url;
    if (
      !positiveInt(id) || typeof url !== "string" ||
      !/^https:\/\/share\.fnnas\.net\/s\/[A-Za-z0-9_-]+$/.test(url) ||
      share.validTo !== validTo
    ) throw invalidResponse();
    for (let attempt = 0; attempt <= 4; attempt += 1) {
      if (share.photoCount === 1) return { url, expiresAt: new Date(validTo * 1000).toISOString() };
      if (share.photoCount !== 0) throw invalidResponse();
      if (attempt === 4) break;
      controller.signal.throwIfAborted();
      if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 500));
      stage("share-detail");
      share = await api("/p/api/v1/share_link/detail", undefined, `id=${id}`);
    }
    throw new Error("相册分享尚未就绪，图纸已保存在本地，请稍后重试");
  } catch (cause) {
    if (timedOut) throw new FnosAlbumError("相册服务响应超时，图纸已保存在本地，请稍后重试", diagnostic);
    if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
    if (cause instanceof FnosSessionError) throw cause;
    if (cause instanceof TypeError) {
      throw new FnosAlbumError("相册服务连接失败，请确认飞牛登录及网络状态，图纸已保存在本地", diagnostic);
    }
    throw new FnosAlbumError(cause instanceof Error ? cause.message : "相册服务请求失败，图纸已保存在本地", diagnostic);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
