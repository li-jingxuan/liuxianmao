import { contextBridge, ipcRenderer } from "electron";
import type { EditorHostAction, EditorHostResult } from "@liuxianmao/lxm-editor-react" with { "resolution-mode": "import" };
import type { DesktopBridge } from "./library-types.cjs";

const actions = new Set<EditorHostAction>(["open", "save", "saveAs", "print", "close"]);
const listeners = new Set<(action: EditorHostAction) => void>();
const outputChunkBytes = 4 * 1024 * 1024;
let closeRequest: number | null = null;
let lastDeliveredClose: number | null = null;

ipcRenderer.on("desktop:action", (_event, action: EditorHostAction, request: unknown) => {
  if (!actions.has(action) || listeners.size === 0) return;
  if (action === "close") {
    if (typeof request !== "number" || request === lastDeliveredClose) return;
    lastDeliveredClose = request;
    closeRequest = request;
  }
  for (const listener of listeners) listener(action);
});

async function invoke<T>(channel: string, ...args: unknown[]): Promise<EditorHostResult<T>> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch {
    return { status: "error", message: "桌面操作未完成，请重试。" };
  }
}

// sandbox 下仅加载 Electron 自带模块。公开 API 固定动作和参数，IPC 事件及退出令牌留在 preload。
const host: DesktopBridge = {
  openScore: () => invoke("desktop:open"),
  saveScore: (request, summary) => invoke("desktop:save", request, summary),
  acceptScore: (id, summary) => invoke("desktop:score-accept", id, summary),
  discardScore: (id) => invoke("desktop:score-discard", id),
  listLibrary: () => invoke("desktop:library-list"),
  importScore: () => invoke("desktop:library-import"),
  openLibraryScore: (id) => invoke("desktop:library-open", id),
  relocateScore: (id) => invoke("desktop:library-relocate", id),
  renameLibraryScore: (id, name) => invoke("desktop:library-rename", id, name),
  removeLibraryScore: (id) => invoke("desktop:library-remove", id),
  retryRegistration: (id) => invoke("desktop:library-retry", id),
  async writeOutput({ suggestedName, bytes }) {
    if (!(bytes instanceof ArrayBuffer)) return { status: "error", message: "导出文件的数据无效。" };
    const start = await invoke<string>("desktop:output-start", { suggestedName, size: bytes.byteLength });
    if (start.status !== "ok") return start;
    const id = start.value;

    // 多页 ZIP 最多约 200 MiB，按小块顺序传输，避免单条 Chromium IPC 消息的大小限制。
    try {
      for (let offset = 0; offset < bytes.byteLength; offset += outputChunkBytes) {
        const result = await invoke("desktop:output-chunk", id, bytes.slice(offset, offset + outputChunkBytes));
        if (result.status !== "ok") return result;
      }
      return await invoke("desktop:output-finish", id);
    } finally {
      await invoke("desktop:output-abort", id);
    }
  },
  print: () => invoke("desktop:print"),
  onAction(listener) {
    listeners.add(listener);
    if (listeners.size === 1) ipcRenderer.send("desktop:ready", true);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) ipcRenderer.send("desktop:ready", false);
    };
  },
  resolveClose(allow) {
    if (closeRequest === null || typeof allow !== "boolean") return;
    ipcRenderer.send("desktop:close-result", closeRequest, allow);
    closeRequest = null;
  },
};

contextBridge.exposeInMainWorld("desktopEditorHost", host);
