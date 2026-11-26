import { LxmEditor, type EditorHost, type EditorHostAction, type EditorSession, type ILXMDocument } from "@liuxianmao/lxm-editor-react";
import "@liuxianmao/lxm-editor-react/styles.css";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@liuxianmao/lxm-editor-react/page.css";
import type { DesktopBridge, IndexWarning, LibraryOutcome } from "../electron/library-types.cjs";
import { LibraryScreen } from "./LibraryScreen";
import { summarizeScore } from "./library-score";
import "./styles.css";

declare global {
  interface Window {
    readonly desktopEditorHost: DesktopBridge;
  }
}

function DesktopApp({ bridge }: { bridge: DesktopBridge }) {
  const [session, setSession] = useState<EditorSession>();
  const [warnings, setWarnings] = useState<IndexWarning[]>([]);
  const [retrying, setRetrying] = useState<string>();
  const [retryError, setRetryError] = useState("");
  const [libraryRevision, setLibraryRevision] = useState(0);
  const actionListener = useRef<((action: EditorHostAction) => void) | null>(null);

  // 窗口一旦就绪就固定保留原生订阅。谱库、编辑器和换谱重建只交接本地处理函数，关闭令牌不会跨工作区重发。
  const listen = useCallback((listener: (action: EditorHostAction) => void) => {
    actionListener.current = listener;
    return () => { if (actionListener.current === listener) actionListener.current = null; };
  }, []);
  useLayoutEffect(() => bridge.onAction((action) => {
    if (actionListener.current) actionListener.current(action);
    else if (action === "close") bridge.resolveClose(false);
  }), [bridge]);

  const observeOutcome = useCallback(({ warning, resolvedWarning }: LibraryOutcome<unknown>) => {
    if (!warning && !resolvedWarning) return;
    setWarnings((current) => {
      const remaining = current.filter(({ id }) => id !== resolvedWarning && id !== warning?.id);
      return warning ? [...remaining, warning] : remaining;
    });
    setRetryError("");
  }, []);

  const host = useMemo<EditorHost>(() => ({
    openScore: () => bridge.openScore(),
    async confirmOpenScore(file, document) {
      const result = await bridge.acceptScore(file.id, summarizeScore(document));
      if (result.status !== "ok") return result;
      observeOutcome(result.value);
      return { status: "ok", value: undefined };
    },
    discardOpenScore: (id) => { void bridge.discardScore(id); },
    async saveScore(request) {
      // 编辑器已经对生成的 JSON 做过格式和排版预检。摘要来自同一份落盘快照，避免读到保存期间才产生的编辑。
      const document = JSON.parse(request.text) as ILXMDocument;
      const result = await bridge.saveScore(request, summarizeScore(document));
      if (result.status !== "ok") return result;
      observeOutcome(result.value);
      return { status: "ok", value: result.value.file };
    },
    writeOutput: (request) => bridge.writeOutput(request),
    print: () => bridge.print(),
    onAction: listen,
    resolveClose: (allow) => bridge.resolveClose(allow),
  }), [bridge, listen, observeOutcome]);

  const retry = async (id: string) => {
    if (retrying) return;
    setRetrying(id);
    setRetryError("");
    try {
      const result = await bridge.retryRegistration(id);
      if (result.status === "error") setRetryError(result.message);
      if (result.status === "ok") {
        observeOutcome({ file: undefined, resolvedWarning: id });
        setLibraryRevision((version) => version + 1);
      }
    } finally { setRetrying(undefined); }
  };

  return <>
    {session ? <LxmEditor fullPage session={session} host={host} navigation={{ homeHref: "#library", homeLabel: "返回谱库", onNavigate: () => setSession(undefined) }} />
      : <LibraryScreen bridge={bridge} onOpen={setSession} listen={listen} observeOutcome={observeOutcome} revision={libraryRevision} />}
    {warnings.length > 0 && <aside className="library-index-warnings" aria-label="谱库登记">
      {warnings.map(({ id, message }) => <div key={id}>
        <p role="alert">{message}</p>
        <button className="library-button" disabled={!!retrying} onClick={() => void retry(id)}>重试登记</button>
      </div>)}
      {retryError && <p role="alert" className="library-error">{retryError}</p>}
    </aside>}
  </>;
}

createRoot(document.getElementById("root")!).render(<DesktopApp bridge={window.desktopEditorHost} />);
