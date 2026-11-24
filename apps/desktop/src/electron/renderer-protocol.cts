import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { protocol, type Session, type WebContents } from "electron";

export const APP_URL = "app://editor/";
export const DEV_URL = "http://127.0.0.1:5179/";

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"],
]);

export function registerEditorScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

function isEditorResource(url: URL) {
  return url.protocol === "app:" && url.host === "editor" && !url.username && !url.password;
}

export function protectRenderer(session: Session, rendererRoot: string, development: boolean) {
  session.protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (!isEditorResource(url) || request.method !== "GET") return new Response(null, { status: 403 });

    // 只允许 Vite 的入口和 assets 目录。按固定字符范围校验，禁止编码路径、分隔符和目录跳转。
    const path = url.pathname;
    const segments = path.split("/").slice(1);
    const isEntry = path === "/" || path === "/index.html";
    const isAsset = segments.length === 2 && segments[0] === "assets" &&
      /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(segments[1]);
    if (!isEntry && !isAsset) return new Response(null, { status: 404 });
    const file = isEntry ? "index.html" : segments.join("/");
    const type = contentTypes.get(extname(file));
    if (!type) return new Response(null, { status: 404 });

    try {
      const bytes = await readFile(join(rendererRoot, file));
      return new Response(new Uint8Array(bytes), { headers: {
        "Content-Type": type,
        "Content-Security-Policy": contentSecurityPolicy,
        "X-Content-Type-Options": "nosniff",
      } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  // 安装包没有外网请求。开发模式唯一额外入口是本机 Vite 与它的热更新 WebSocket。
  session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const localData = url.protocol === "data:" ||
      (url.protocol === "blob:" && url.pathname.startsWith(development ? DEV_URL : APP_URL));
    const devServer = development && (url.origin === new URL(DEV_URL).origin ||
      url.origin === "ws://127.0.0.1:5179");
    callback({ cancel: !(isEditorResource(url) || localData || devServer) });
  });
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.on("will-download", (event) => event.preventDefault());
}

export function protectNavigation(contents: WebContents, development: boolean) {
  // 主进程 loadURL 无需走页面导航。开发时允许 Vite 重载入口，子框架和弹窗始终拒绝。
  contents.on("will-navigate", (event) => {
    if (!development || event.url !== DEV_URL) event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    if (!development || !event.isMainFrame || event.url !== DEV_URL) event.preventDefault();
  });
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}
