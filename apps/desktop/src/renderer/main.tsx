import { createEditorSession, LxmEditor, type EditorHost } from "@liuxianmao/lxm-editor-react";
import "@liuxianmao/lxm-editor-react/styles.css";
import { createRoot } from "react-dom/client";
import "@liuxianmao/lxm-editor-react/page.css";
import "./styles.css";

declare global {
  interface Window {
    readonly desktopEditorHost: EditorHost;
  }
}

// 桌面启动空白会话，工具栏和原生菜单通过同一宿主工作流处理文件及退出。
const session = createEditorSession();
createRoot(document.getElementById("root")!).render(
  <LxmEditor fullPage session={session} host={window.desktopEditorHost} />,
);
