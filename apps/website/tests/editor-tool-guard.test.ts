import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT, LXMScoreCommandEnum as C, getFirstTabCellReference } from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import { captureEditorToolIntent, editorToolSubmissionReason, tabToolTargetReason } from "../components/EditorShell/tools/editor-tool-guard";
import { createEditorCommandAdapter } from "../components/EditorShell/session/editor-command-adapter";
import { createEditorModalController } from "../components/EditorShell/session/editor-modal-controller";
import { createEditorDraftCoordinator, createEditorDraftOwner } from "../components/EditorShell/session/editor-draft-coordinator";
import { captureEditorVersion } from "../components/EditorShell/session/editor-session-version";
import { createTechniqueParameterOwner } from "../components/EditorShell/tools/technique-parameter-owner";
import type { MusicTextTarget } from "../components/EditorShell/music-text/music-text-draft";

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const cell = getFirstTabCellReference(session.getState().document!)!;
  session.getState().setSelection({ anchor: cell, focus: cell });
  const drafts = createEditorDraftCoordinator(() => captureEditorVersion(session.getState()));
  return { session, cell, drafts };
};

describe("toolbar final submission guard", () => {
  it("rejects retained TAB selection with either numbered focus source, including the actual adapter", async () => {
    const { session, cell, drafts } = setup();
    let active: MusicTextTarget | null = { kind: "numbered", trackId: cell.trackId, measureId: cell.measureId, eventId: "event" };
    const command = { type: C.SetBeatKindRange, range: { trackId: cell.trackId, anchor: cell, focus: cell }, kind: "rest" } as const;
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const adapter = createEditorCommandAdapter(session, modals,
      (cmd, submission) => editorToolSubmissionReason(session.getState(), active, drafts, cmd, submission));
    expect(await adapter(command)).toMatchObject({ status: "blocked", message: "请先选择 TAB 目标。" });
    active = null;
    session.setState({ numberedSelection: { trackId: cell.trackId, measureId: cell.measureId, anchorEventId: "a", focusEventId: "a" } as never });
    expect(tabToolTargetReason(session.getState(), active)).toBe("请先选择 TAB 目标。");
    expect(await adapter(command)).toMatchObject({ status: "blocked" });
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("a revision reused after undo cannot revive an intent; active target identity also invalidates it", () => {
    const { session, cell } = setup();
    let active: MusicTextTarget | null = null;
    const isCurrent = captureEditorToolIntent(session.getState, () => active);
    const originalRevision = session.getState().document!.documentRevision;
    session.getState().execute({ type: C.SetBeatKindRange, range: { trackId: cell.trackId, anchor: cell, focus: cell }, kind: "rest" });
    session.getState().undo();
    expect(session.getState().document!.documentRevision).toBe(originalRevision);
    expect(isCurrent()).toBe(false);
    const next = captureEditorToolIntent(session.getState, () => active);
    active = { kind: "numbered", trackId: cell.trackId, measureId: cell.measureId, eventId: "a" };
    expect(next()).toBe(false);
  });
  it("asynchronous confirmation rechecks the live active target before writing", async () => {
    const { session, cell, drafts } = setup();
    let active: MusicTextTarget | null = null;
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const adapter = createEditorCommandAdapter(session, modals,
      (cmd, submission) => editorToolSubmissionReason(session.getState(), active, drafts, cmd, submission));
    const pending = adapter({ type: C.RemoveMeasure, trackId: cell.trackId, measureId: cell.measureId }, "modal", {
      tabOnly: true, isCurrent: captureEditorToolIntent(session.getState, () => active),
    });
    expect(modals.getSnapshot()).not.toBeNull();
    active = { kind: "numbered", trackId: cell.trackId, measureId: cell.measureId, eventId: "a" };
    expect(await modals.confirm(modals.getSnapshot()!.id)).toBe(false);
    expect(await pending).toMatchObject({ status: "stale" });
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("unapplied technique parameters allow handoff while active IME and other owners remain protected", async () => {
    const { session, cell, drafts } = setup();
    const parameters = createTechniqueParameterOwner(drafts);
    parameters.setDirty(true);
    const command = { type: C.AddTechnique, trackId: cell.trackId, technique: { type: "vibrato", fromNoteId: "note" } } as const;
    const register = () => parameters.register({ targetKey: "tab:a", inputKey: "value", version: captureEditorVersion(session.getState()),
      focus: () => true,
      apply: async ({ isCurrent }) => {
        expect(isCurrent()).toBe(true);
        expect(editorToolSubmissionReason(session.getState(), null, drafts, command, { owner: parameters.owner })).toBeNull();
        return "applied";
      }, discard: () => { parameters.reset(); return true; } });
    register();
    expect(parameters.canHide()).toBe(true);
    expect(parameters.canHandoff()).toBe(true);
    expect(drafts.inspect().pending).toEqual([]);
    expect(editorToolSubmissionReason(session.getState(), null, drafts, command)).toBeNull();
    expect(editorToolSubmissionReason(session.getState(), null, drafts, command, { owner: parameters.owner })).toBeNull();
    parameters.compositionStart(); register();
    expect(parameters.canHide()).toBe(false);
    expect(parameters.canHandoff()).toBe(false);
    expect(editorToolSubmissionReason(session.getState(), null, drafts, command)).not.toBeNull();
    parameters.compositionEnd(); register();
    expect(parameters.canHide()).toBe(false);
    expect(drafts.inspect().composing).toBe(true);
    parameters.releaseCompositionBuffer(); register();
    expect(parameters.canHide()).toBe(true);
    expect(await drafts.request({ type: "apply", id: "technique-parameters" })).toMatchObject({ status: "accepted" });
    const other = createEditorDraftOwner();
    const unregister = drafts.register({ id: "other", kind: "settings", targetKey: "settings", label: "设置", dirty: true,
      composing: false, canApply: true, error: null, version: captureEditorVersion(session.getState()),
      focus: () => true, discard: () => true, apply: () => "applied" }, { owner: other, generation: 0 });
    expect(editorToolSubmissionReason(session.getState(), null, drafts, command, { owner: parameters.owner })).not.toBeNull();
    unregister();
    parameters.setBusy(true); expect(parameters.canHide()).toBe(false);
    parameters.setBusy(false); parameters.reset();
    expect(parameters.canHandoff()).toBe(true);
    expect(drafts.inspect().pending).toEqual([]);
  });
});
