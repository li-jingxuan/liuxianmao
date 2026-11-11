import { LXMScoreCommandEnum as C, resolveTabCellSelection, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import type { EditorStoreState } from "../../../stores/editor-store";
import { captureEditorVersion, sameEditorVersion } from "../session/editor-session-version";
import type { EditorDraftOwner, EditorDraftCoordinator } from "../session/editor-draft-coordinator";
import type { MusicTextTarget } from "../music-text/music-text-draft";

export interface EditorToolSubmission {
  owner?: EditorDraftOwner;
  /** Checked immediately before execution and again inside every asynchronous confirmation. */
  isCurrent?: () => boolean;
  tabOnly?: boolean;
}
export const isTabOnlyToolCommand = (command: ILXMScoreCommand) =>
  command.type === C.SetBeatKindRange || command.type === C.AddTechnique ||
  command.type === C.UpdateTechnique || command.type === C.RemoveTechnique;

export const tabToolTargetReason = (
  state: Pick<EditorStoreState, "selection" | "numberedSelection" | "document">,
  activeTarget: MusicTextTarget | null,
): string | null => {
  if (state.numberedSelection || activeTarget?.kind === "numbered" || !state.selection || !state.document)
    return "请先选择 TAB 目标。";
  return resolveTabCellSelection(state.document, state.selection).ok ? null : "TAB 目标已失效，请重新选择。";
};

/** Capture AFTER the existing fret-draft action. Read active target from a live ref. */
export const captureEditorToolIntent = (
  getState: () => EditorStoreState,
  getActiveTarget: () => MusicTextTarget | null,
): (() => boolean) => {
  const state = getState();
  const version = captureEditorVersion(state);
  const selection = JSON.stringify(state.selection);
  const numbered = JSON.stringify(state.numberedSelection);
  const active = JSON.stringify(getActiveTarget());
  const techniqueId = state.selectedTechniqueId;
  return () => sameEditorVersion(getState(), version) &&
    selection === JSON.stringify(getState().selection) &&
    numbered === JSON.stringify(getState().numberedSelection) &&
    techniqueId === getState().selectedTechniqueId &&
    active === JSON.stringify(getActiveTarget());
};

export const editorToolSubmissionReason = (
  state: EditorStoreState,
  active: MusicTextTarget | null,
  drafts: EditorDraftCoordinator,
  command: ILXMScoreCommand,
  submission?: EditorToolSubmission,
): string | null => {
  if (submission?.isCurrent && !submission.isCurrent()) return "目标或文档已变化，请重新操作。";
  if (submission?.tabOnly || isTabOnlyToolCommand(command)) {
    const reason = tabToolTargetReason(state, active);
    if (reason) return reason;
  }
  const other = drafts.inspect(submission?.owner);
  return other.busy || other.pending.some((item) => item.kind !== "fret" && item.kind !== "beatPaste")
    ? "请先处理其他编辑草稿。" : null;
};
