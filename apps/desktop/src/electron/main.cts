import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, session, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import type { EditorHostAction } from "@liuxianmao/lxm-editor-react" with { "resolution-mode": "import" };
import { WindowEditorHost } from "./editor-host.cjs";
import { APP_URL, DEV_URL, protectNavigation, protectRenderer, registerEditorScheme } from "./renderer-protocol.cjs";

type MenuAction = Exclude<EditorHostAction, "close">;
type ClosePurpose = "close" | "quit";
type EditorWindow = {
  window: BrowserWindow;
  host: WindowEditorHost;
  ready: boolean;
  pendingAction: MenuAction | null;
  pendingClose: { id: number; purpose: ClosePurpose } | null;
  allowClose: boolean;
};

const isMac = process.platform === "darwin";
const development = !app.isPackaged && process.env.LXM_DESKTOP_DEV === "1";
const rendererUrl = development ? DEV_URL : APP_URL;

let current: EditorWindow | null = null;
let nextCloseId = 0;
let quitting = false;

app.setName("六线猫");
app.setAppUserModelId("cn.liuxianmao.desktop");
registerEditorScheme();

function fromEditor(event: IpcMainInvokeEvent | IpcMainEvent) {
  const state = current;
  const frame = event.senderFrame;
  // 校验活动窗口、顶层 frame 和精确的编辑器入口。子框架及其他 app:// 资源均无文件权限。
  if (!state || state.window.isDestroyed() || state.window.webContents !== event.sender ||
      !frame || frame !== event.sender.mainFrame || frame.url.split("#")[0] !== rendererUrl) return null;
  return state;
}

function registerIpc() {
  type Handler = (host: WindowEditorHost, ...args: unknown[]) => unknown;
  const operations: Record<string, [number, Handler]> = {
    "desktop:open": [0, (host) => host.openScore()],
    "desktop:save": [1, (host, request) => host.saveScore(request)],
    "desktop:print": [0, (host) => host.print()],
    "desktop:output-start": [1, (host, request) => host.beginOutput(request)],
    "desktop:output-chunk": [2, (host, id, bytes) => host.outputChunk(id, bytes)],
    "desktop:output-finish": [1, (host, id) => host.finishOutput(id)],
    "desktop:output-abort": [1, (host, id) => host.abortOutput(id)],
  };
  for (const [channel, [count, handle]] of Object.entries(operations)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const state = fromEditor(event);
      if (!state || args.length !== count) return { status: "error", message: "无效的桌面宿主请求。" };
      return handle(state.host, ...args);
    });
  }

  ipcMain.on("desktop:ready", (event, ready: unknown) => {
    const state = fromEditor(event);
    if (!state || typeof ready !== "boolean" || state.ready === ready) return;
    state.ready = ready;
    if (!ready) return;
    if (state.pendingClose) {
      state.pendingAction = null;
      state.window.webContents.send("desktop:action", "close", state.pendingClose.id);
    } else if (state.pendingAction) {
      state.window.webContents.send("desktop:action", state.pendingAction);
      state.pendingAction = null;
    }
  });

  ipcMain.on("desktop:close-result", (event, id: unknown, allow: unknown) => {
    const state = fromEditor(event);
    const pending = state?.pendingClose;
    if (!state || !pending || pending.id !== id || typeof allow !== "boolean") return;
    state.pendingClose = null;
    if (!allow) return;

    state.allowClose = true;
    if (pending.purpose === "quit") {
      quitting = true;
      app.quit();
    } else {
      state.window.close();
    }
  });
}

function requestClose(state: EditorWindow, purpose: ClosePurpose) {
  // 系统关闭、文件菜单和 Cmd+Q 共用此次请求。等待期间若又请求退出，升级目标但保留同一个保护流程。
  if (state.pendingClose) {
    if (purpose === "quit") state.pendingClose.purpose = purpose;
    return;
  }
  state.pendingClose = { id: ++nextCloseId, purpose };
  if (state.ready) state.window.webContents.send("desktop:action", "close", state.pendingClose.id);
}

function createEditorWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    useContentSize: true,
    show: false,
    title: "六线猫",
    backgroundColor: "#f4f6fa",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  const state: EditorWindow = {
    window, host: new WindowEditorHost(window), ready: false,
    pendingAction: null, pendingClose: null, allowClose: false,
  };
  current = state;
  protectNavigation(window.webContents, development);
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) state.ready = false;
  });
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (state.allowClose) return;
    event.preventDefault();
    requestClose(state, "close");
  });
  window.on("closed", () => {
    state.host.dispose();
    if (current === state) current = null;
  });
  void window.loadURL(rendererUrl).catch(() => {
    if (window.isDestroyed()) return;
    dialog.showErrorBox("六线猫", "编辑器未能启动，请重新打开六线猫。");
    state.allowClose = true;
    window.close();
  });
  return state;
}

function dispatchMenuAction(action: MenuAction) {
  const state = current ?? (action === "open" ? createEditorWindow() : null);
  if (!state || state.pendingClose) return;
  if (state.ready) state.window.webContents.send("desktop:action", action);
  else state.pendingAction = action;
}

function createMenu() {
  const menu: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "打开…", accelerator: "CommandOrControl+O", click: () => dispatchMenuAction("open") },
        { label: "保存", accelerator: "CommandOrControl+S", click: () => dispatchMenuAction("save") },
        { label: "另存为…", accelerator: "CommandOrControl+Shift+S", click: () => dispatchMenuAction("saveAs") },
        { type: "separator" },
        { label: "打印…", accelerator: "CommandOrControl+P", click: () => dispatchMenuAction("print") },
        { type: "separator" },
        { label: "关闭窗口", accelerator: "CommandOrControl+W", click: () => current?.window.close() },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "剪切", role: "cut" }, { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" },
      ],
    },
  ];
  if (isMac) {
    menu.unshift({ label: app.name, submenu: [
      { label: "关于六线猫", role: "about" }, { type: "separator" },
      { label: "退出六线猫", accelerator: "Command+Q", click: () => app.quit() },
    ] });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!app.isReady() || quitting) return;
    const state = current ?? createEditorWindow();
    if (state.window.isMinimized()) state.window.restore();
    state.window.focus();
  });
  app.on("activate", () => {
    if (app.isReady() && !current && !quitting) createEditorWindow();
  });
  app.on("before-quit", (event) => {
    if (!current || quitting) return;
    event.preventDefault();
    requestClose(current, "quit");
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });

  void app.whenReady().then(() => {
    protectRenderer(session.defaultSession, join(__dirname, "..", "renderer"), development);
    registerIpc();
    createMenu();
    if (!current) createEditorWindow();
  });
}
