type UploadSession = { secret: string; token: string };
type NativeBridge = {
  _platformReady?: boolean;
  callHandler: (method: string) => Promise<unknown>;
};
type NativeWindow = Window & { flutter_inappwebview?: NativeBridge };

const READY_EVENT = "flutterInAppWebViewPlatformReady";
const SESSION_TIMEOUT_MS = 5_000;
let platformReady = false;
if (typeof window !== "undefined") {
  // 与 SDK 一样记住一次性就绪事件，后续上传只重新读取会话。
  window.addEventListener(READY_EVENT, () => { platformReady = true; }, { once: true });
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

function shape(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object" || depth >= 2) return typeof value;
  // 仅报告字段名和类型，绝不包含字符串内容、数值或会话材料。
  return `{${Object.entries(value).slice(0, 8).map(([key, child]) =>
    `${/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(key) ? key : "?"}:${shape(child, depth + 1)}`,
  ).join(",")}}`;
}

function nativeSession(raw: unknown): UploadSession {
  let payload: unknown = raw;
  try {
    // 与飞牛 SDK 相同：原生桥返回 JSON envelope，result 内还有一层 JSON。
    let data = object(raw);
    payload = data;
    if ("result" in data) { data = object(data.result); payload = data; }
    if ("data" in data) { data = object(data.data); payload = data; }
    return validate(data.secret, data.token);
  } catch {
    throw new Error(`无法获取飞牛 App 的相册上传会话（会话字段：${shape(payload)}），请反馈此提示，图纸已保存在本地`);
  }
}

/** 每次读取当前宿主会话；不缓存、不写入 localStorage，也不记录桥接响应。 */
export async function getFnosUploadSession(signal?: AbortSignal): Promise<UploadSession> {
  signal?.throwIfAborted();
  const host = window as NativeWindow;
  const mobile = /FNAppVer\//i.test(navigator.userAgent) || !!host.flutter_inappwebview;
  if (!mobile) {
    let secret: string | null;
    try {
      secret = window.localStorage.getItem("fnos-Secret");
    } catch {
      throw new Error("无法读取飞牛相册会话，请在飞牛网页端登录后重试，图纸已保存在本地");
    }
    if (!secret) {
      throw new Error("当前飞牛宿主未提供相册上传会话，请在飞牛网页端登录后重试，图纸已保存在本地");
    }
    try {
      const cookie = document.cookie.split(/;\s*/).find((entry) => entry.startsWith("fnos-token="));
      return validate(secret, cookie ? decodeURIComponent(cookie.slice("fnos-token=".length)) : "");
    } catch {
      throw new Error("飞牛登录已失效，请重新登录后重试，图纸已保存在本地");
    }
  }

  const apple = /(iPad|iPhone|iPod|Macintosh|Mac OS X)/i.test(navigator.userAgent);
  let started = false;
  let timer: number | undefined;
  let poll: number | undefined;
  let onReady: () => void = () => {};
  let onAbort: () => void = () => {};
  try {
    return await new Promise<UploadSession>((resolve, reject) => {
      const check = () => {
        const bridge = host.flutter_inappwebview;
        if (started || !bridge || typeof bridge.callHandler !== "function" || !(apple || platformReady || bridge._platformReady)) return;
        started = true;
        // Promise.resolve 捕获同步抛错；只保留经过校验的 secret/token。
        Promise.resolve().then(() => {
          signal?.throwIfAborted();
          return bridge.callHandler("getUserMessage");
        })
          .then((raw) => {
            try { resolve(nativeSession(raw)); } catch (cause) { reject(cause); }
          }, () => reject(unavailable()));
      };
      onReady = check;
      onAbort = () => reject(signal?.reason ?? new DOMException("上传已取消", "AbortError"));
      window.addEventListener(READY_EVENT, onReady);
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(() => reject(unavailable()), SESSION_TIMEOUT_MS);
      // 兼容页面载入后才注入桥、且就绪事件已触发的宿主。
      poll = window.setInterval(check, 50);
      if (signal?.aborted) onAbort();
      else check();
    });
  } finally {
    window.clearTimeout(timer);
    window.clearInterval(poll);
    window.removeEventListener(READY_EVENT, onReady);
    signal?.removeEventListener("abort", onAbort);
  }
}
