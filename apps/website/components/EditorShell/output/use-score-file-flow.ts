"use client";

import { useEffect, useRef, useState } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import type { StoreApi } from "zustand/vanilla";
import { selectScoreFileStatus, type EditorStoreState } from "../../../stores/editor-store";
import type { EditorDraftCoordinator } from "../session/editor-draft-coordinator";
import { captureEditorVersion, sameEditorVersion, type EditorSessionVersion } from "../session/editor-session-version";
import { downloadScoreFile } from "./score-file";

export type ScoreFilePanel = "new" | "import" | "json";
type PendingAction = {
  label: string;
  version: EditorSessionVersion;
  run: (discard: boolean) => void;
};

export function useScoreFileFlow({ session, drafts, isBlocked, onBlocked, onReplacement }: {
  session: StoreApi<EditorStoreState>;
  drafts?: EditorDraftCoordinator;
  isBlocked?: () => boolean;
  onBlocked?: (trigger: HTMLElement | null) => void;
  onReplacement?: () => void;
}) {
  const [panel, setPanel] = useState<ScoreFilePanel>();
  const [pending, setPending] = useState<PendingAction>();
  const [downloaded, setDownloaded] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const origin = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<PendingAction | undefined>(undefined);
  const allowUnload = useRef(false);
  const allowPageUnload = () => { allowUnload.current = true; };

  useEffect(() => {
    if (!drafts) return;
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
  }, [session, drafts]);

  const checkDrafts = (trigger = origin.current) => {
    if (!isBlocked?.()) return true;
    setPanel(undefined);
    onBlocked?.(trigger);
    return false;
  };

  const cancel = () => {
    const trigger = origin.current;
    setPanel(undefined);
    setPending(undefined);
    pendingRef.current = undefined;
    setDownloaded("");
    setError("");
    // 等工作区的浮层协调器解除背景 inert，再恢复文件菜单入口焦点。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }));
  };

  const showPanel = (next: ScoreFilePanel, trigger: HTMLElement | null) => {
    if (!checkDrafts(trigger)) return;
    origin.current = trigger?.closest("[inert]") && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : trigger;
    setPanel(next);
    setError("");
    setNotice("");
  };

  const confirmLeave = (label: string, run: PendingAction["run"], version: EditorSessionVersion) => {
    setPanel(undefined);
    setDownloaded("");
    setError("");
    const action = { label, run, version };
    pendingRef.current = action;
    setPending(action);
  };

  const requestReplacement = (document: ILXMDocument, source: "file" | "new", version: EditorSessionVersion, filename?: string) => {
    if (!checkDrafts()) return;
    const current = session.getState();
    if (!sameEditorVersion(current, version)) {
      cancel();
      setNotice("当前曲谱已变化，请重新发起操作。");
      return;
    }
    const replace = () => {
      const result = session.getState().replaceDocument(document, source, filename);
      if (result.ok) { setPanel(undefined); onReplacement?.(); }
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

  const currentAction = () => {
    const action = pendingRef.current;
    if (!action) return;
    if (!sameEditorVersion(session.getState(), action.version)) {
      setDownloaded("");
      setError("当前曲谱已变化，请继续编辑后重新发起此操作。");
      return;
    }
    if (!checkDrafts()) { setPending(undefined); pendingRef.current = undefined; return; }
    return action;
  };

  const finishLeave = (discard: boolean) => {
    const action = currentAction();
    if (!action || (!discard && !downloaded)) return;
    pendingRef.current = undefined;
    setPending(undefined);
    setDownloaded("");
    setError("");
    action.run(discard);
  };

  const exportJson = (forLeave: boolean) => {
    if (forLeave ? !currentAction() : !checkDrafts()) return;
    const state = session.getState();
    if (!state.document) return;
    if (forLeave) setDownloaded("");
    setError("");
    const result = downloadScoreFile(state.document);
    if (!result.ok) { setError(result.errors.join("；")); return; }
    session.getState().recordScoreExport(state.document, state.sessionVersion);
    if (forLeave) setDownloaded(result.name);
    else {
      cancel();
      setNotice(`已发起 JSON 下载「${result.name}」。`);
    }
  };

  return { panel, pending, downloaded, error, notice, cancel, showPanel, requestReplacement, requestNavigation, finishLeave, exportJson, checkDrafts, allowPageUnload };
}
