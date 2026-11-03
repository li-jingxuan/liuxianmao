type UploadSession = { secret: string; token: string };
type NativeBridge = {
  _platformReady?: boolean;
  callHandler: (method: string) => Promise<unknown>;
};
type NativeWindow = Window & { flutter_inappwebview?: NativeBridge };
export const FNOS_SESSION_BUILD = "20261104.1";

const READY_EVENT = "flutterInAppWebViewPlatformReady";
const SESSION_TIMEOUT_MS = 5_000;
let platformReady = false;
const readyParents = new WeakSet<Window>();
const watchedParents = new WeakSet<Window>();

function sameOriginParent(): NativeWindow | undefined {
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin) {
      return window.parent as NativeWindow;
    }
  } catch { /* 不访问跨来源宿主，也不向它发送凭据请求。 */ }
  return undefined;
}

function watchParent(parent: NativeWindow | undefined): void {
  if (!parent || watchedParents.has(parent)) return;
  watchedParents.add(parent);
  parent.addEventListener(READY_EVENT, () => { readyParents.add(parent); }, { once: true });
}

if (typeof window !== "undefined") {
  // 与 SDK 一样记住一次性就绪事件，后续上传只重新读取会话。
  window.addEventListener(READY_EVENT, () => { platformReady = true; }, { once: true });
  watchParent(sameOriginParent());
}

type Diagnostic = {
  version: 2;
  build: string;
  platform: "android" | "apple" | "other";
  appVersion: string;
  frame: "top" | "same-origin-frame" | "cross-origin-frame";
  bridge: "none" | "current" | "same-origin-parent";
  readyEventObserved: boolean;
  platformReady: boolean;
  stage: string;
  responseShape?: string;
  credentialSource?: "native" | "browser-storage" | "cookie";
  cookieSession?: "missing" | "invalid" | "blocked" | "available";
};

function diagnosticText(diagnostic: Diagnostic): string {
  return `飞牛会话诊断 v2\n${JSON.stringify(diagnostic, null, 2)}`;
}

export class FnosSessionError extends Error {
  readonly diagnostic: string;
  constructor(message: string, diagnostic: Diagnostic) {
    super(`${message}（${diagnostic.stage}），图纸已保存在本地`);
    this.name = "FnosSessionError";
    this.diagnostic = diagnosticText(diagnostic);
  }
}

function failure(diagnostic: Diagnostic, stage: string, message = "无法获取飞牛 App 的相册上传会话"): FnosSessionError {
  diagnostic.stage = stage;
  return new FnosSessionError(message, diagnostic);
}

function createDiagnostic(): Diagnostic {
  const ua = navigator.userAgent;
  return {
    version: 2, build: FNOS_SESSION_BUILD,
    platform: /Android/i.test(ua) ? "android" : /(iPad|iPhone|iPod|Macintosh|Mac OS X)/i.test(ua) ? "apple" : "other",
    appVersion: ua.match(/FNAppVer\/(\d+(?:\.\d+){0,5})\b/i)?.[1] ?? "unknown",
    frame: window.parent === window ? "top" : sameOriginParent() ? "same-origin-frame" : "cross-origin-frame",
    bridge: "none", readyEventObserved: false, platformReady: false, stage: "initializing",
  };
}

function findBridge(diagnostic: Diagnostic): NativeBridge | undefined {
  const parent = sameOriginParent();
  watchParent(parent);
  let pending: { bridge: NativeBridge; source: Diagnostic["bridge"]; event: boolean } | undefined;
  for (const [host, source] of [[window as NativeWindow, "current"], [parent, "same-origin-parent"]] as const) {
    const bridge = host?.flutter_inappwebview;
    if (bridge && typeof bridge.callHandler === "function") {
      const event = source === "current" ? platformReady : !!(parent && readyParents.has(parent));
      if (diagnostic.platform === "apple" || event || bridge._platformReady === true) {
        diagnostic.bridge = source;
        diagnostic.readyEventObserved = event;
        diagnostic.platformReady = bridge._platformReady === true;
        return bridge;
      }
      pending ??= { bridge, source, event };
    }
  }
  diagnostic.bridge = pending?.source ?? "none";
  diagnostic.readyEventObserved = pending?.event ?? false;
  diagnostic.platformReady = false;
  return pending?.bridge;
}

function unavailable(): Error {
  return new Error("无法获取飞牛 App 的相册上传会话，请退出后重新打开拼豆，图纸已保存在本地");
}

function validate(secret: unknown, token: unknown): UploadSession {
  try {
    if (typeof secret !== "string" || secret.length > 4096 || !atob(secret)) throw unavailable();
    if (token !== undefined && (typeof token !== "string" || token.length > 8192 || /[^\x20-\x7e]/.test(token))) {
      throw unavailable();
    }
    return { secret, token: typeof token === "string" ? token : "" };
  } catch {
    throw unavailable();
  }
}

function cookieSession(diagnostic: Diagnostic): UploadSession | undefined {
  let cookies: string[];
  try {
    cookies = document.cookie.split(/;\s*/);
  } catch {
    diagnostic.cookieSession = "blocked";
    return;
  }
  const secrets = cookies.filter((entry) => entry.startsWith("fnos-Secret="));
  if (secrets.length === 0) {
    diagnostic.cookieSession = "missing";
    return;
  }
  try {
    // 与飞牛自带 Docker 前端的 Cookie 来源一致。拒绝同名多值，避免路径 Cookie 歧义。
    const tokens = cookies.filter((entry) => entry.startsWith("fnos-token="));
    if (secrets.length !== 1 || tokens.length > 1) throw unavailable();
    const secret = decodeURIComponent(secrets[0].slice("fnos-Secret=".length));
    const token = tokens.length ? decodeURIComponent(tokens[0].slice("fnos-token=".length)) : undefined;
    const session = validate(secret, token);
    diagnostic.cookieSession = "available";
    return session;
  } catch {
    diagnostic.cookieSession = "invalid";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    if (value.length > 64 * 1024) throw unavailable();
    value = JSON.parse(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const data = value as Record<string, unknown>;
  if ("code" in data && data.code !== 0) throw unavailable();
  return data;
}

const DIAGNOSTIC_FIELDS = new Set([
  "result", "data", "code", "msg", "message", "error", "status", "success", "reqId", "reqid", "method",
  "secret", "token", "userInfo", "user", "username", "uid", "id", "uploadSecret", "accessToken",
  "session", "credentials", "sessionSecret", "uploadToken", "userMessage",
]);

function shape(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object" || depth >= 2) return typeof value;
  // 仅输出固定白名单字段名；未知 key 本身也可能是凭据，不能原样显示。
  return `{${Object.entries(value).slice(0, 8).map(([key, child]) =>
    `${DIAGNOSTIC_FIELDS.has(key) ? key : "unknown"}:${shape(child, depth + 1)}`,
  ).join(",")}}`;
}

function nativeSession(raw: unknown, diagnostic: Diagnostic): UploadSession {
  let payload: unknown = raw;
  try {
    // 与飞牛 SDK 相同：原生桥返回 JSON envelope，result 内还有一层 JSON。
    let data = object(raw);
    payload = data;
    if ("result" in data) { data = object(data.result); payload = data; }
    if ("data" in data) { data = object(data.data); payload = data; }
    return validate(data.secret, data.token);
  } catch {
    diagnostic.responseShape = shape(payload);
    throw failure(diagnostic, "FNS_RESPONSE_UNRECOGNIZED");
  }
}

async function acquireSession(diagnostic: Diagnostic, signal?: AbortSignal): Promise<UploadSession> {
  signal?.throwIfAborted();
  const mobile = /FNAppVer\//i.test(navigator.userAgent) || !!findBridge(diagnostic);
  if (!mobile) {
    let secret: string | null;
    try {
      secret = window.localStorage.getItem("fnos-Secret");
    } catch {
      throw failure(diagnostic, "FNS_WEB_STORAGE_BLOCKED", "无法读取飞牛相册会话，请在飞牛网页端登录后重试");
    }
    if (!secret) {
      throw failure(diagnostic, "FNS_WEB_SECRET_MISSING", "当前飞牛宿主未提供相册上传会话，请在飞牛网页端登录后重试");
    }
    try {
      const cookie = document.cookie.split(/;\s*/).find((entry) => entry.startsWith("fnos-token="));
      const session = validate(secret, cookie ? decodeURIComponent(cookie.slice("fnos-token=".length)) : "");
      diagnostic.credentialSource = "browser-storage";
      diagnostic.stage = "FNS_READY";
      return session;
    } catch {
      throw failure(diagnostic, "FNS_WEB_SESSION_INVALID", "飞牛登录已失效，请重新登录后重试");
    }
  }

  const apple = /(iPad|iPhone|iPod|Macintosh|Mac OS X)/i.test(navigator.userAgent);
  let started = false;
  let finished = false;
  let timer: number | undefined;
  let poll: number | undefined;
  let onReady: () => void = () => {};
  let onAbort: () => void = () => {};
  const parent = sameOriginParent();
  watchParent(parent);
  try {
    return await new Promise<UploadSession>((resolve, reject) => {
      const check = () => {
        if (started) return;
        const bridge = findBridge(diagnostic);
        if (!bridge || !(apple || diagnostic.readyEventObserved || diagnostic.platformReady)) return;
        started = true;
        diagnostic.stage = "FNS_CALLING";
        // Promise.resolve 捕获同步抛错；只保留经过校验的 secret/token。
        Promise.resolve().then(() => {
          signal?.throwIfAborted();
          return bridge.callHandler("getUserMessage");
        })
          .then((raw) => {
            try {
              if (finished) return;
              signal?.throwIfAborted();
              if (raw === null || raw === undefined) {
                diagnostic.responseShape = raw === null ? "null" : "undefined";
                const session = cookieSession(diagnostic);
                if (!session) throw failure(diagnostic, "FNS_NATIVE_EMPTY");
                diagnostic.credentialSource = "cookie";
                diagnostic.stage = "FNS_READY";
                resolve(session);
                return;
              }
              const session = nativeSession(raw, diagnostic);
              diagnostic.credentialSource = "native";
              diagnostic.stage = "FNS_READY";
              resolve(session);
            } catch (cause) { reject(cause); }
          }, () => reject(failure(diagnostic, "FNS_HANDLER_REJECTED")));
      };
      onReady = check;
      onAbort = () => reject(signal?.reason ?? new DOMException("上传已取消", "AbortError"));
      window.addEventListener(READY_EVENT, onReady);
      parent?.addEventListener(READY_EVENT, onReady);
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(() => {
        if (!started) findBridge(diagnostic);
        reject(failure(diagnostic, started ? "FNS_HANDLER_TIMEOUT" : diagnostic.bridge === "none" ? "FNS_NO_BRIDGE" : "FNS_NOT_READY"));
      }, SESSION_TIMEOUT_MS);
      // 兼容页面载入后才注入桥、且就绪事件已触发的宿主。
      poll = window.setInterval(check, 50);
      if (signal?.aborted) onAbort();
      else check();
    });
  } finally {
    finished = true;
    window.clearTimeout(timer);
    window.clearInterval(poll);
    window.removeEventListener(READY_EVENT, onReady);
    parent?.removeEventListener(READY_EVENT, onReady);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 每次读取当前宿主会话；不缓存、不写入 localStorage，也不记录桥接响应。 */
export async function getFnosUploadSession(signal?: AbortSignal, report?: (diagnostic: string) => void): Promise<UploadSession> {
  const diagnostic = createDiagnostic();
  const session = await acquireSession(diagnostic, signal);
  report?.(diagnosticText(diagnostic));
  return session;
}

/** 只返回固定诊断字段；成功取得的凭据立即丢弃，不发送网络请求。 */
export async function diagnoseFnosUploadSession(signal?: AbortSignal): Promise<string> {
  const diagnostic = createDiagnostic();
  try {
    await acquireSession(diagnostic, signal);
    return diagnosticText(diagnostic);
  } catch (cause) {
    if (signal?.aborted) throw new DOMException("检查已取消", "AbortError");
    if (cause instanceof FnosSessionError) return cause.diagnostic;
    diagnostic.stage = "FNS_UNEXPECTED_ERROR";
    return diagnosticText(diagnostic);
  }
}
