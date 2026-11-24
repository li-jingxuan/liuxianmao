"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import type { StoreApi } from "zustand/vanilla";
import { selectScoreFileStatus, type EditorStoreState } from "../../stores/editor-store";
import type { EditorDraftCoordinator } from "../session/editor-draft-coordinator";
import type { EditorHost, EditorHostFile } from "../../editor-host";
import { captureEditorVersion, sameEditorSession, sameEditorVersion, type EditorSessionVersion } from "../session/editor-session-version";
import { downloadScoreFile, SCORE_FILE_LABEL, serializeScoreFile } from "./score-file";

export type ScoreFilePanel = "new" | "import" | "json";
type PendingAction = {
  label: string;
  version: EditorSessionVersion;
  run: (discard: boolean) => void;
  onCancel?: () => void;
};
export type BoundScoreFile = EditorHostFile & Pick<EditorSessionVersion, "sessionId" | "sessionVersion"> & { sourceVersion?: number };
export type NativeImport = EditorHostFile & { bytes: ArrayBuffer; version: EditorSessionVersion };

export function useScoreFileFlow({ session, drafts, isBlocked, onBlocked, onReplacement, onNotice, host, boundFileRef }: {
  session: StoreApi<EditorStoreState>;
  drafts?: EditorDraftCoordinator;
  isBlocked?: () => boolean;
  onBlocked?: (trigger: HTMLElement | null) => void;
  onReplacement?: () => void;
  onNotice?: (type: "success" | "warning", content: string) => void;
  host?: EditorHost;
  boundFileRef?: RefObject<BoundScoreFile | undefined>;
}) {
  const [panel, setPanel] = useState<ScoreFilePanel>();
  const [pending, setPending] = useState<PendingAction>();
  const [downloaded, setDownloaded] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nativeImport, setNativeImport] = useState<NativeImport>();
  const [saving, setSaving] = useState(false);
  const showNotice = (type: "success" | "warning", content: string) => {
    if (onNotice) onNotice(type, content);
    else setNotice(content);
  };
  const origin = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<PendingAction | undefined>(undefined);
  const nativeTask = useRef<object | null>(null);
  const allowUnload = useRef(false);
  const allowPageUnload = () => { allowUnload.current = true; };

  // 已提交曲谱是否需要保存与表单是否有待应用内容是两道独立保护。
  // 只有任一保护条件成立时才注册浏览器离开事件，卸载时同时释放两个订阅。
  useEffect(() => {
    if (!drafts || host) return;
    const needsProtection = () => selectScoreFileStatus(session.getState()) === "pending" || drafts.isOutputBlocked();
    const handleUnload = (event: BeforeUnloadEvent) => {
      if (allowUnload.current || !needsProtection()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    let listening = false;
    const sync = () => {
      const protect = needsProtection();
      if (protect === listening) return;
      listening = protect;
      if (protect) window.addEventListener("beforeunload", handleUnload);
      else window.removeEventListener("beforeunload", handleUnload);
    };
    const unsubscribeSession = session.subscribe((state, prev) => {
      if (state.document !== prev.document || state.fileBaseline !== prev.fileBaseline) sync();
    });
    const unsubscribeDrafts = drafts.subscribe(sync);
    sync();
    return () => {
      unsubscribeSession();
      unsubscribeDrafts();
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [session, drafts, host]);

  useEffect(() => () => { nativeTask.current = null; }, [session, host]);

  const checkDrafts = (trigger = origin.current) => {
    if (!isBlocked?.()) return true;
    setPanel(undefined);
    onBlocked?.(trigger);
    return false;
  };

  const cancel = () => {
    if (saving) return;
    const trigger = origin.current;
    setPanel(undefined);
    setNativeImport(undefined);
    setPending(undefined);
    pendingRef.current?.onCancel?.();
    pendingRef.current = undefined;
    setDownloaded("");
    setError("");
    // 等工作区的浮层协调器解除背景 inert，再恢复文件菜单入口焦点。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }));
  };

  const openNative = async () => {
    if (!host) return;
    const version = captureEditorVersion(session.getState());
    const task = {};
    nativeTask.current = task;
    try {
      const result = await host.openScore();
      if (nativeTask.current !== task) return;
      if (result.status === "error") showNotice("warning", result.message);
      if (result.status !== "ok") return;
      // 系统对话框打开后，任何文档变更都会使这次换谱意图失效。
      if (!sameEditorVersion(session.getState(), version)) {
        showNotice("warning", "选择文件期间曲谱已变化，请重新打开。");
        return;
      }
      if (!checkDrafts()) return;
      setNativeImport({ ...result.value, version });
      setPanel("import");
    } catch {
      if (nativeTask.current === task) showNotice("warning", "暂时无法打开曲谱文件，请重试。");
    } finally {
      if (nativeTask.current === task) nativeTask.current = null;
    }
  };

  const showPanel = (next: ScoreFilePanel, trigger: HTMLElement | null) => {
    if (host && (nativeTask.current || panel || pendingRef.current)) return;
    if (!checkDrafts(trigger)) return;
    origin.current = trigger?.closest("[inert]") && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : trigger;
    setError("");
    setNotice("");
    if (host && next === "import") void openNative();
    else setPanel(next);
  };

  const confirmLeave = (label: string, run: PendingAction["run"], version: EditorSessionVersion, onCancel?: () => void) => {
    setPanel(undefined);
    setNativeImport(undefined);
    setDownloaded("");
    setError("");
    const action = { label, run, version, onCancel };
    pendingRef.current = action;
    setPending(action);
  };

  const requestReplacement = (document: ILXMDocument, source: "file" | "new", version: EditorSessionVersion, filename?: string, sourceVersion?: number) => {
    if (!checkDrafts()) return;
    const current = session.getState();
    if (!sameEditorVersion(current, version)) {
      cancel();
      showNotice("warning", "当前曲谱已变化，请重新发起操作。");
      return;
    }
    const replace = () => {
      const result = session.getState().replaceDocument(document, source, filename);
      if (result.ok) {
        if (boundFileRef) {
          const { sessionId, sessionVersion } = session.getState();
          boundFileRef.current = source === "file" && nativeImport
            ? { id: nativeImport.id, name: nativeImport.name, sourceVersion, sessionId, sessionVersion }
            : undefined;
        }
        setPanel(undefined);
        setNativeImport(undefined);
        onReplacement?.();
      }
      else setError(result.errors.join("；"));
    };
    if (selectScoreFileStatus(current) === "pending") {
      confirmLeave(source === "new" ? "新建曲谱" : `打开「${filename}」`, replace, version);
    } else replace();
  };

  const requestNavigation = (label: string, trigger: HTMLElement | null, run: PendingAction["run"]) => {
    if (!checkDrafts(trigger)) return false;
    const current = session.getState();
    if (selectScoreFileStatus(current) !== "pending") return true;
    origin.current = trigger;
    confirmLeave(label, run, captureEditorVersion(current));
    return false;
  };

  const requestClose = () => {
    if (!host) return;
    // 系统只等待本次请求的响应。其他文件操作或草稿对话框结束后可再次尝试关闭。
    if (nativeTask.current || panel || pendingRef.current || !checkDrafts(null)) {
      host.resolveClose(false);
      return;
    }
    const state = session.getState();
    if (selectScoreFileStatus(state) !== "pending") {
      host.resolveClose(true);
      return;
    }
    origin.current = null;
    confirmLeave("关闭窗口", () => host.resolveClose(true), captureEditorVersion(state), () => host.resolveClose(false));
  };

  const currentAction = () => {
    const action = pendingRef.current;
    if (!action) return;
    // 留在确认框期间仍可能有宿主写入或文件替换，下载与继续离开都重新核对原版本。
    if (!sameEditorVersion(session.getState(), action.version)) {
      setDownloaded("");
      setError("当前曲谱已变化，请继续编辑后重新发起此操作。");
      return;
    }
    if (!checkDrafts()) {
      action.onCancel?.();
      setPending(undefined);
      pendingRef.current = undefined;
      return;
    }
    return action;
  };

  const finishLeave = (discard: boolean) => {
    const action = currentAction();
    if (!action || (host && nativeTask.current) || (!discard && !downloaded)) return;
    pendingRef.current = undefined;
    setPending(undefined);
    setDownloaded("");
    setError("");
    action.run(discard);
  };

  const saveNative = async (saveAs = false, forLeave = false, trigger: HTMLElement | null = null) => {
    if (!host || nativeTask.current || panel || (!forLeave && pendingRef.current)) return;
    const action = forLeave ? currentAction() : undefined;
    if (forLeave ? !action : !checkDrafts(trigger)) return;
    const state = session.getState();
    if (!state.document) return;
    const version = captureEditorVersion(state);
    const report = (message: string) => { if (action) setError(message); else showNotice("warning", message); };
    const serialized = serializeScoreFile(state.document);
    if (!serialized.ok) { report(serialized.errors.join("；")); return; }
    const existing = boundFileRef?.current;
    const bound = !saveAs && existing?.sessionId === version.sessionId && existing.sessionVersion === version.sessionVersion
      ? existing : undefined;
    const task = {};
    nativeTask.current = task;
    setSaving(true);
    setError("");
    try {
      const result = await host.saveScore({
        fileId: bound?.id,
        suggestedName: serialized.name,
        text: serialized.text,
        confirmUpgrade: bound?.sourceVersion !== undefined,
      });
      const current = session.getState();
      if (nativeTask.current !== task || !sameEditorSession(current, version)) return;
      if (result.status === "error") report(result.message);
      if (result.status !== "ok") return;
      if (boundFileRef) boundFileRef.current = { ...result.value, sessionId: version.sessionId, sessionVersion: version.sessionVersion };
      // 记录真正落盘的快照。保存期间的新编辑仍然待保存，不能随关闭或换谱一起放弃。
      current.recordScoreExport(state.document, version.sessionVersion);
      if (action) {
        if (selectScoreFileStatus(session.getState()) === "pending" || !sameEditorVersion(session.getState(), version)) {
          report("保存期间曲谱已变化，请继续编辑后重新发起此操作。");
          return;
        }
        if (!currentAction()) return;
        pendingRef.current = undefined;
        setPending(undefined);
        action.run(false);
      } else showNotice("success", `已保存「${result.value.name}」。`);
    } catch {
      if (nativeTask.current === task && sameEditorSession(session.getState(), version)) report("暂时无法保存曲谱文件，请重试。");
    } finally {
      if (nativeTask.current === task) {
        nativeTask.current = null;
        setSaving(false);
      }
    }
  };

  const exportJson = (forLeave: boolean) => {
    if (forLeave ? !currentAction() : !checkDrafts()) return;
    const state = session.getState();
    if (!state.document) return;
    if (forLeave) setDownloaded("");
    setError("");
    const result = downloadScoreFile(state.document);
    if (!result.ok) { setError(result.errors.join("；")); return; }
    // 浏览器成功发起下载后更新保存基线，后续文档修改会重新进入待导出状态。
    session.getState().recordScoreExport(state.document, state.sessionVersion);
    if (forLeave) setDownloaded(result.name);
    else {
      cancel();
      showNotice("success", `已发起${SCORE_FILE_LABEL}下载「${result.name}」。`);
    }
  };

  const isNativeBusy = () => nativeTask.current !== null;
  return { panel, pending, downloaded, error, notice, nativeImport, saving, host, isNativeBusy, cancel, showPanel,
    requestReplacement, requestNavigation, requestClose, finishLeave, exportJson, saveNative, checkDrafts, allowPageUnload };
}
