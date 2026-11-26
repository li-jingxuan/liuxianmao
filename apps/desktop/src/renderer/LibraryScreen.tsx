import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createBlankScore, createEditorSession, decodeScoreFile,
  type EditorHostAction, type EditorSession,
} from "@liuxianmao/lxm-editor-react";
import type { DesktopBridge, LibraryEntry, LibraryOutcome, ScoreCandidate } from "../electron/library-types.cjs";
import { LibraryDialogs, type LibraryDialogState, type Preview, type ScoreSelection } from "./LibraryDialogs";
import { summarizeScore } from "./library-score";
import { LibraryView } from "./LibraryView";

function inspect(file: ScoreCandidate, selection: ScoreSelection) {
  const checked = decodeScoreFile(file.bytes);
  if (!checked.ok) return { error: checked.errors.join("；") };
  const preview: Preview = {
    kind: "preview", file, selection, document: checked.document, summary: summarizeScore(checked.document),
    sourceVersion: checked.upgraded ? checked.sourceVersion : undefined,
  };
  return { preview };
}

export function LibraryScreen({ bridge, onOpen, observeOutcome, listen, revision }: {
  bridge: DesktopBridge;
  onOpen(session: EditorSession): void;
  observeOutcome(result: LibraryOutcome<unknown>): void;
  listen(listener: (action: EditorHostAction) => void): () => void;
  revision: number;
}) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [unavailable, setUnavailable] = useState(new Set<string>());
  const [dialog, setDialog] = useState<LibraryDialogState>();
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  const working = useRef(false);
  const listTask = useRef<Promise<void> | null>(null);
  const previewId = useRef<string | undefined>(undefined);
  const nativeHandler = useRef<(action: EditorHostAction) => void>(() => {});

  const reload = useCallback(async () => {
    if (listTask.current) return listTask.current;
    const task = (async () => {
      setLoading(true);
      const result = await bridge.listLibrary();
      if (result.status === "ok") {
        setEntries(result.value);
        setLoadError("");
      } else if (result.status === "error") setLoadError(result.message);
      setLoading(false);
    })();
    listTask.current = task;
    try { await task; }
    finally { if (listTask.current === task) listTask.current = null; }
  }, [bridge]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);
  useEffect(() => {
    return () => {
      window.clearTimeout(noticeTimer.current);
      if (previewId.current) void bridge.discardScore(previewId.current);
    };
  }, [bridge]);

  const message = (content: string) => {
    setNotice(content);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 3400);
  };
  const discardPreview = () => {
    if (previewId.current) void bridge.discardScore(previewId.current);
    previewId.current = undefined;
  };
  const close = () => {
    if (working.current) return;
    discardPreview();
    setDialog(undefined);
    setError("");
  };
  const run = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      // 启动时允许立即发出系统打开，先等首份索引快照结束，避免争用原生文件操作。
      await listTask.current;
      await operation();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const choose = (selection: ScoreSelection) => void run(async () => {
    const result = selection.mode === "relocate" ? await bridge.relocateScore(selection.entry.id)
      : selection.mode === "import" ? await bridge.importScore() : await bridge.openScore();
    // 取消原生选择时保留母对话框及上一份预览。新选择失败只替换预览，不触碰库或原件。
    if (result.status === "cancelled") return;
    discardPreview();
    if (result.status === "error") {
      setDialog({ kind: "selectError", selection });
      setError(result.message);
      return;
    }
    const { preview, error: invalid } = inspect(result.value, selection);
    if (preview) {
      previewId.current = result.value.id;
      setDialog(preview);
    } else {
      void bridge.discardScore(result.value.id);
      setDialog({ kind: "selectError", selection, file: { name: result.value.name, path: result.value.path } });
      setError(invalid);
    }
  });

  const accept = async (preview: Preview) => {
    const { file, summary, document, sourceVersion, selection } = preview;
    const result = await bridge.acceptScore(file.id, summary);
    if (result.status !== "ok") return result.status === "error" ? result.message : "操作已取消，请重新选择曲谱。";
    previewId.current = undefined;
    observeOutcome(result.value);
    if (selection.mode === "import") {
      setDialog(undefined);
      await reload();
      message(`已将「${summary.title.trim() || file.name}」加入谱库。`);
      return;
    }
    const session = createEditorSession();
    // 用已确认的窗口授权创建文件保存基线，随后挂载同一个编辑器会话，直接保存即可写回原件。
    const loaded = session.replaceDocument(document, { kind: "file", file: result.value.file, sourceVersion });
    if (!loaded.ok) return loaded.errors.join("；");
    onOpen(session);
  };

  const open = (entry: LibraryEntry) => void run(async () => {
    const fail = (message: string) => {
      setUnavailable((previous) => new Set(previous).add(entry.id));
      setDialog({ kind: "openError", entry });
      setError(message);
    };
    const result = await bridge.openLibraryScore(entry.id);
    if (result.status !== "ok") {
      if (result.status === "error") fail(result.message);
      return;
    }
    const { preview, error: invalid } = inspect(result.value, { mode: "open" });
    if (preview) {
      previewId.current = result.value.id;
      const failure = await accept(preview);
      if (failure) fail(failure);
    } else {
      void bridge.discardScore(result.value.id);
      fail(invalid);
    }
  });

  const update = (action: "rename" | "remove", entry: LibraryEntry, name = "") => void run(async () => {
    const result = action === "rename" ? await bridge.renameLibraryScore(entry.id, name) : await bridge.removeLibraryScore(entry.id);
    if (result.status === "error") setError(result.message);
    if (result.status !== "ok") return;
    setDialog(undefined);
    await reload();
    message(action === "rename" ? "已更新库内显示名。" : "已从谱库移除，原件已保留。");
  });

  const newScore = (title: string, arranger: string) => {
    if (!title) { setError("请填写曲名。"); return; }
    const session = createEditorSession();
    const document = createBlankScore({ title, arranger, tonality: { version: 1, mode: "major", tonic: "C" }, timeSignature: { numerator: 4, denominator: 4 } });
    const result = session.replaceDocument(document, { kind: "new" });
    if (result.ok) onOpen(session);
    else setError(result.errors.join("；"));
  };

  useLayoutEffect(() => {
    nativeHandler.current = (action) => {
      if (action === "close") bridge.resolveClose(!working.current);
      if (action === "open" && !working.current && !dialog) choose({ mode: "open" });
    };
  });
  useLayoutEffect(() => listen((action) => nativeHandler.current(action)), [listen]);

  return <>
    <LibraryView entries={entries} unavailable={unavailable} busy={busy} loading={loading} loadError={loadError} notice={notice}
      onNew={() => { setError(""); setDialog({ kind: "new" }); }} onImport={() => choose({ mode: "import" })} onOpen={open} onReload={() => void reload()}
      onManage={(kind, entry) => { setError(""); setDialog({ kind, entry }); }} />
    {dialog && <LibraryDialogs key={dialog.kind} state={dialog} busy={busy} error={error} onClose={close} onNew={newScore}
      onChoose={choose} onOpen={open} onAccept={(preview) => void run(async () => { setError(await accept(preview) ?? ""); })}
      onRename={(entry, name) => update("rename", entry, name)} onRemove={(entry) => update("remove", entry)} />}
  </>;
}
