import {
  LXMScoreCommandEnum,
  planBeatPaste,
  resolveTabCellSelection,
  type BeatClipboard,
  type BeatPastePlan,
  type ILXMScoreCommand,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../stores/editor-store";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import type { EditorDraftCoordinator } from "./editor-draft-coordinator";
import type { EditorModalController } from "./editor-modal-controller";
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
  type EditorSessionVersion,
} from "./editor-session-version";

type Mode = "insert" | "overwrite";
type Plan = Extract<BeatPastePlan, { ok: true }>;
interface Candidate {
  version: EditorSessionVersion;
  clipboardVersion: number;
  clipboard: BeatClipboard;
  selectionKey: string;
  target: { trackId: string; measureId: string; beatId: string };
  plan: Plan | null;
  removedIds: string[];
  changedIds: string[];
}
export interface BeatPasteSnapshot {
  phase:
    | "idle"
    | "ready"
    | "planning-error"
    | "needs-impact"
    | "applying"
    | "stale";
  mode: Mode;
  layers: "tab" | "both";
  candidate: Candidate | null;
  confirmed: boolean;
  error: string | null;
  notice: string | null;
}
export type BeatPasteIntent =
  | { type: "prepare" | "mode"; mode: Mode }
  | { type: "layers"; layers: "tab" | "both" }
  | { type: "confirm"; checked: boolean }
  | { type: "apply" | "cancel" | "focus" };
export interface BeatPasteController {
  getSnapshot: () => BeatPasteSnapshot;
  subscribe: (listener: () => void) => () => void;
  request: (intent: BeatPasteIntent) => Promise<boolean>;
  start: () => () => void;
  invalidate: () => void;
  canApply: () => boolean;
}
const selectionKey = (selection: ILXMTabCellSelection | null) =>
  JSON.stringify(selection && [selection.anchor, selection.focus]);

/** 预览与草稿登记共享唯一状态；UI 重排不改变候选，版本改变显式失效。 */
export const createBeatPasteController = ({
  session,
  drafts,
  modals,
  execute,
  beforeAction,
  getBlockedReason,
  restoreFocus,
}: {
  session: StoreApi<EditorStoreState>;
  drafts: EditorDraftCoordinator;
  modals: EditorModalController;
  execute: EditorCommandAdapter;
  beforeAction: () => void;
  getBlockedReason: () => string | null;
  restoreFocus: () => void;
}): BeatPasteController => {
  let state: BeatPasteSnapshot = {
    phase: "idle",
    mode: "insert",
    layers: "both",
    candidate: null,
    confirmed: false,
    error: null,
    notice: null,
  };
  let generation = 0;
  let ownedError: string | null = null;
  let modalId: number | null = null;
  let unregister: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const current = (candidate: Candidate) => {
    const now = session.getState();
    return (
      sameEditorVersion(now, candidate.version) &&
      now.clipboardVersion === candidate.clipboardVersion &&
      selectionKey(now.selection) === candidate.selectionKey &&
      !getBlockedReason()
    );
  };
  const canApply = () =>
    !!state.candidate?.plan &&
    (state.phase === "ready" || state.phase === "needs-impact") &&
    (!(
      state.candidate.plan.requiresConfirmation ||
      state.candidate.removedIds.length ||
      state.candidate.changedIds.length
    ) ||
      state.confirmed);
  const register = () => {
    unregister?.();
    unregister = null;
    if (!state.candidate) return;
    unregister = drafts.register({
      id: `beatPaste:${session.getState().sessionId}`,
      kind: "beatPaste",
      targetKey: state.candidate.selectionKey,
      label: "拍点粘贴预览",
      dirty: true,
      composing: false,
      canApply: canApply(),
      error: state.phase === "needs-impact" ? null : state.error,
      version: state.candidate.version,
      focus: () => {
        void request({ type: "focus" });
        return modalId !== null && modals.getSnapshot()?.id === modalId;
      },
      apply: async ({ isCurrent }) =>
        !isCurrent()
          ? "stale"
          : (await request({ type: "apply" }))
            ? "applied"
            : "blocked",
      discard: () => {
        if (state.phase === "applying") return false;
        void request({ type: "cancel" });
        return true;
      },
    });
  };
  const update = (next: Partial<BeatPasteSnapshot>, syncDraft = true) => {
    state = { ...state, ...next };
    if (syncDraft) register();
    publish();
  };
  const clear = (phase: "idle" | "stale", notice: string | null) => {
    const clearOwnError =
      state.candidate &&
      sameEditorSession(session.getState(), state.candidate.version) &&
      ownedError !== null &&
      session.getState().errorMessage === ownedError;
    generation++;
    unregister?.();
    unregister = null;
    state = {
      ...state,
      candidate: null,
      confirmed: false,
      phase,
      error: null,
      notice,
    };
    publish();
    ownedError = null;
    if (clearOwnError) session.getState().setErrorMessage(null);
  };
  const invalidate = () => {
    if (
      !state.candidate ||
      state.phase === "applying" ||
      current(state.candidate)
    )
      return;
    const sameSession = sameEditorSession(
      session.getState(),
      state.candidate.version,
    );
    const id = modalId;
    clear("stale", sameSession ? "粘贴预览已过期，请重新预览。" : null);
    if (id !== null) modals.close(id, "stale");
  };
  const show = (): boolean => {
    if (!state.candidate) return false;
    if (modalId !== null && modals.getSnapshot()?.id === modalId) {
      // 已在原预览内；定位只聚焦真实可见的预览区域。
      if (typeof document !== "undefined")
        document.getElementById("beat-paste-preview")?.focus();
      return true;
    }
    const ownGeneration = generation;
    modalId = modals.open({
      kind: "beat-paste",
      title: "拍点粘贴预览",
      message: "",
      preview: controller,
      version: state.candidate.version,
      confirm: () => apply(),
      restoreFocus,
      onClose: (reason) => {
        modalId = null;
        if (ownGeneration !== generation) return;
        clear(
          reason === "stale" ? "stale" : "idle",
          reason === "stale"
            ? state.candidate &&
              sameEditorSession(session.getState(), state.candidate.version)
              ? "粘贴预览已过期，请重新预览。"
              : null
            : state.notice,
        );
      },
    });
    return modalId !== null;
  };
  const replan = (mode: Mode) => {
    const candidate = state.candidate;
    if (!candidate || !current(candidate)) {
      invalidate();
      return false;
    }
    const plan = planBeatPaste(
      candidate.version.document!,
      { ...candidate.target, mode },
      candidate.clipboard,
    );
    update({
      mode,
      candidate: {
        ...candidate,
        plan: plan.ok ? plan : null,
        removedIds: [],
        changedIds: [],
      },
      confirmed: false,
      phase: plan.ok ? "ready" : "planning-error",
      error: plan.ok ? null : plan.message,
    });
    return plan.ok;
  };
  const apply = async (): Promise<boolean> => {
    if (!canApply()) return false;
    const candidate = state.candidate!;
    if (!current(candidate)) {
      invalidate();
      return false;
    }
    beforeAction();
    const plan = planBeatPaste(
      session.getState().document!,
      { ...candidate.target, mode: state.mode },
      candidate.clipboard,
    );
    if (!plan.ok || plan.confirmationKey !== candidate.plan!.confirmationKey) {
      update({
        confirmed: false,
        phase: "planning-error",
        error: plan.ok ? "粘贴预览已过期，请重新预览。" : plan.message,
      });
      return false;
    }
    const ownGeneration = generation;
    const command: ILXMScoreCommand = {
      type: LXMScoreCommandEnum.PasteBeats,
      ...candidate.target,
      mode: state.mode,
      clipboard: candidate.clipboard,
      allowOverwrite: state.confirmed,
      expectedConfirmationKey: plan.confirmationKey,
      expectedRevision: candidate.version.document!.documentRevision,
      confirmedRemovedMarkIds: candidate.removedIds,
      confirmedChangedMarkIds: candidate.changedIds,
    };
    // 应用期间不替换登记身份，否则协调器的 isCurrent 将把自己的操作视为过期。
    update({ phase: "applying", error: null }, false);
    try {
      const outcome = await execute(command, "caller");
      if (ownGeneration !== generation) return false;
      if (!sameEditorSession(session.getState(), candidate.version)) {
        clear("stale", null);
        return false;
      }
      if (outcome.status === "applied" || outcome.status === "noop") {
        clear(
          "idle",
          outcome.status === "applied" ? "已粘贴，可撤销。" : "内容未变化。",
        );
        return true;
      }
      if (!current(candidate)) {
        update({ phase: "ready" }, false);
        invalidate();
        return false;
      }
      if (outcome.status === "needs-impact") {
        ownedError = outcome.result.message;
        update({
          phase: "needs-impact",
          confirmed: false,
          candidate: {
            ...candidate,
            removedIds: outcome.result.removedMarkIds ?? [],
            changedIds: outcome.result.changedMarkIds ?? [],
          },
          error: `公共结构影响：${outcome.result.message}。请核对后重新确认。`,
        });
      } else
        update({
          phase: "planning-error",
          confirmed: false,
          error: outcome.message,
        });
    } catch {
      if (ownGeneration === generation)
        update({
          phase: "planning-error",
          confirmed: false,
          error: "粘贴失败，请重新预览或取消。",
        });
    }
    return false;
  };
  const request = async (intent: BeatPasteIntent): Promise<boolean> => {
    if (state.phase === "applying") return false;
    if (intent.type === "apply") {
      const id = modalId;
      return id !== null ? modals.confirm(id) : false;
    }
    if (intent.type === "cancel") {
      if (modalId !== null) return modals.close(modalId, "cancel");
      clear("idle", null);
      return true;
    }
    if (intent.type === "focus") return show();
    if (intent.type === "layers") {
      update({ layers: intent.layers }, false);
      return true;
    }
    if (intent.type === "confirm") {
      update({ confirmed: intent.checked });
      return true;
    }
    if (intent.type === "mode") return replan(intent.mode);
    if (modals.isOpen()) {
      update({ notice: "请先完成当前弹层操作。" }, false);
      return false;
    }
    if (intent.type !== "prepare") return false;
    beforeAction();
    const blocked = getBlockedReason();
    if (blocked) {
      update({ notice: blocked }, false);
      return false;
    }
    const now = session.getState(),
      target = now.selection?.focus,
      clipboard = now.getBeatClipboard();
    const range =
      now.document &&
      now.selection &&
      resolveTabCellSelection(now.document, now.selection);
    if (!now.document || !target || !clipboard || !range?.ok) {
      update({ notice: "请先复制拍点，并选择有效的 TAB 目标。" }, false);
      return false;
    }
    const plan = planBeatPaste(
      now.document,
      { ...target, mode: intent.mode },
      clipboard,
    );
    if (!plan.ok) {
      update({ notice: plan.message }, false);
      return false;
    }
    generation++;
    update({
      phase: "ready",
      mode: intent.mode,
      confirmed: false,
      error: null,
      notice: null,
      candidate: {
        version: captureEditorVersion(now),
        clipboardVersion: now.clipboardVersion,
        clipboard,
        selectionKey: selectionKey(now.selection),
        target: {
          trackId: target.trackId,
          measureId: target.measureId,
          beatId: target.beatId,
        },
        plan,
        removedIds: [],
        changedIds: [],
      },
    });
    if (!show()) {
      clear("idle", "请先完成当前弹层操作。");
      return false;
    }
    return true;
  };
  const controller: BeatPasteController = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request,
    invalidate,
    canApply,
    start: () => {
      const release = session.subscribe(invalidate);
      return () => {
        release();
        const id = modalId;
        clear("idle", null);
        if (id !== null) modals.close(id, "stale");
      };
    },
  };
  return controller;
};
