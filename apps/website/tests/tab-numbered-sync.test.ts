import { describe, expect, it, vi } from "vitest";
import {
  applyScoreCommand,
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum as C,
  type ILXMDocument,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { buildTabNumberedSyncCommand } from "../components/EditorShell/tab-numbered-sync";
import { createEditorCommandAdapter } from "../components/EditorShell/editor-command-adapter";
import { createEditorModalController } from "../components/EditorShell/editor-modal-controller";
import { createEditorDraftCoordinator } from "../components/EditorShell/editor-draft-coordinator";
import { captureEditorToolIntent, editorToolSubmissionReason } from "../components/EditorShell/editor-tool-guard";
import { createEditorSession } from "../stores/editor-store";
import { inspectScoreFile, serializeScoreFile } from "../components/EditorShell/score-file";

const fixture = (splitTab = false): ILXMDocument => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.numberedMarks = [];
  track.techniques = [];
  const measure = track.measures[0]!;
  measure.numberedVoice = { tuplets: [], events: [{
    id: "sync-original", tick: 0, kind: "notes", rhythm: { base: "quarter", dots: 0 },
    items: [{ id: "sync-original-item", token: "1" }],
  }] };
  measure.lyrics = [1, 2].map((verse) => ({
    id: `sync-lyric-${verse}`, eventId: "sync-original", verse: verse as 1 | 2, text: verse === 1 ? "轻" : "风",
  }));
  if (!splitTab) return document;
  const result = applyScoreCommand(document, {
    type: C.SplitBeat, trackId: track.id, measureId: measure.id, beatId: measure.beats[0]!.id,
  });
  if (!result.ok) throw new Error(result.message);
  return result.document;
};

it("连续组合拆分结果可直接保存并重开，不在两个 TAB Beat 间共享时值对象", () => {
  let document = fixture();
  for (let index = 0; index < 2; index++) {
    const track = document.score.tracks[0]!, measure = track.measures[0]!;
    const result = applyScoreCommand(document, {
      type: "beat.splitAndAlignNumbered", trackId: track.id, measureId: measure.id, beatId: measure.beats[0]!.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    document = result.document;
    const saved = serializeScoreFile(document);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.errors.join(";"));
    const reopened = inspectScoreFile(saved.text);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.document).toEqual(document);
  }
});

const setup = (splitTab = false, empty = false) => {
  const source = fixture(splitTab);
  if (empty) {
    source.score.tracks[0]!.measures[0]!.numberedVoice.events = [];
    source.score.tracks[0]!.measures[0]!.lyrics = [];
  }
  const session = createEditorSession(source);
  const document = session.getState().document!;
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const cell = { trackId: track.id, measureId: measure.id, beatId: measure.beats[0]!.id, string: 1 };
  const selection = { anchor: cell, focus: { ...cell, beatId: measure.beats[splitTab ? 1 : 0]!.id, string: 6 } };
  session.getState().setSelection(selection);
  const modals = createEditorModalController(session.getState, () => vi.fn());
  const drafts = createEditorDraftCoordinator(session.getState);
  const execute = createEditorCommandAdapter(session, modals, (command, submission) =>
    editorToolSubmissionReason(session.getState(), null, drafts, command, submission));
  const built = buildTabNumberedSyncCommand(document, selection, splitTab ? "align" : "split");
  if (!built.ok) throw new Error(built.message);
  return { session, document, track, measure, cell, selection, modals, drafts, execute, command: built.command };
};

describe("TAB 节奏同步命令构建", () => {
  it("同 beat 多根弦仅构建一次拆分，连续 beat 按真实区间构建事后细分", () => {
    const single = setup();
    expect(single.command).toEqual({ type: "beat.splitAndAlignNumbered", trackId: single.track.id,
      measureId: single.measure.id, beatId: single.cell.beatId, expectedRevision: single.document.documentRevision });
    const range = setup(true);
    expect(range.command).toMatchObject({ type: "numbered.range.alignToTab", startTick: 0, endTick: 960 });
    expect(buildTabNumberedSyncCommand(range.document, range.selection, "split")).toMatchObject({ ok: false });
  });
  it("拒绝空选择、跨小节或不存在的目标", () => {
    const { document, selection, track } = setup();
    expect(buildTabNumberedSyncCommand(document, null, "align").ok).toBe(false);
    const cross: ILXMTabCellSelection = { ...selection, focus: { ...selection.focus,
      measureId: track.measures[1]!.id, beatId: track.measures[1]!.beats[0]!.id } };
    expect(buildTabNumberedSyncCommand(document, cross, "align").ok).toBe(false);
    expect(buildTabNumberedSyncCommand(document, { ...selection, focus: { ...selection.focus, beatId: "missing" } }, "align").ok).toBe(false);
  });
});

describe("TAB 节奏同步确认、焦点与历史", () => {
  it.each([false, true])("纯预览可取消，不替换文档、不写历史；事后模式 %s", async (align) => {
    const { session, document, selection, modals, execute, command } = setup(align);
    const pending = execute(command);
    const modal = modals.getSnapshot()!;
    expect(modal.request.kind).toBe("rhythm-sync");
    expect(modal.request.confirmLabel).toBe(align ? "应用细分" : "拆分并同步");
    expect(modal.request.message).toContain("缩短 1 个原简谱位置，新增 1 个空位");
    expect(modal.request.message).toContain("2 处原词");
    expect(modal.request.message).toContain("八分音符空位");
    if (!align) expect(modal.request.message).toContain("保持原持续音");
    expect(session.getState().document).toBe(document);
    expect(session.getState().historyDepth.past).toBe(0);
    modals.close(modal.id, "cancel");
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(session.getState().document).toBe(document);
    expect(session.getState().selection).toEqual(selection);
  });
  it.each([false, true])("成功一次提交、重复确认零双写、TAB 选择保留并聚焦新 gap；事后模式 %s", async (align) => {
    const { session, document, selection, measure, modals, execute, command } = setup(align);
    const pending = execute(command);
    const id = modals.getSnapshot()!.id;
    const first = modals.confirm(id);
    expect(await modals.confirm(id)).toBe(false);
    expect(await first).toBe(true);
    expect(await pending).toMatchObject({ status: "applied" });
    const state = session.getState();
    expect(state.historyDepth.past).toBe(1);
    expect(state.document!.documentRevision).toBe(document.documentRevision + 1);
    expect(state.pastEntries[0]!.label).toBe(align ? "按所选 TAB 节奏细分简谱" : "TAB 拆分并同步");
    expect(state.selection).toEqual(selection);
    const updated = state.document!.score.tracks[0]!.measures[0]!;
    const gap = updated.numberedVoice.events.find((event) => event.tick === 480)!;
    expect(gap.kind).toBe("gap");
    expect(state.numberedSelection).toMatchObject({ kind: "numberedEvent", eventId: gap.id });
    expect(updated.lyrics).toEqual(measure.lyrics);
    expect(updated.numberedVoice.events[0]).toMatchObject({ id: "sync-original", items: measure.numberedVoice.events[0]!.items });
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
    session.getState().redo();
    expect(session.getState().document).toEqual(state.document);
    expect(session.getState().historyDepth.past).toBe(1);
  });
  it("无新边界的事后细分不写文档、revision 或历史", async () => {
    const { session, document, selection, modals, execute } = setup();
    const built = buildTabNumberedSyncCommand(document, selection, "align");
    if (!built.ok) throw new Error(built.message);
    expect(await execute(built.command)).toMatchObject({ status: "noop" });
    expect(modals.getSnapshot()).toBeNull();
    expect(session.getState().document).toBe(document);
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it.each(["selection", "undo", "document", "submission"] as const)("确认前 %s 变化使预览过期，零写入", async (change) => {
    const { session, document, cell, modals, execute, command } = setup();
    let current = true;
    const intent = captureEditorToolIntent(session.getState, () => null);
    const pending = execute(command, "modal", { isCurrent: () => current && intent() });
    const id = modals.getSnapshot()!.id;
    if (change === "selection") session.getState().setSelection({ anchor: cell, focus: { ...cell, string: 2 } });
    if (change === "undo") {
      session.getState().execute({ type: C.SetBeatKind, ...cell, kind: "rest" });
      session.getState().undo();
      expect(session.getState().document!.documentRevision).toBe(document.documentRevision);
    }
    if (change === "document") session.getState().replaceDocument(document);
    if (change === "submission") current = false;
    const before = session.getState().document;
    expect(await modals.confirm(id)).toBe(false);
    expect(await pending).toMatchObject({ status: "stale", message: "谱面或选择已变化，请重新检查细分结果" });
    expect(session.getState().document).toBe(before);
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("统一预览占用期间阻止其他命令，确认前重新检查新出现的草稿", async () => {
    const { session, document, cell, modals, drafts, execute, command } = setup();
    const pending = execute(command);
    expect(await execute(command)).toMatchObject({ status: "blocked" });
    expect(await execute({ type: C.SetBeatKind, ...cell, kind: "rest" })).toMatchObject({ status: "blocked" });
    drafts.register({ id: "late-lyric", kind: "lyric", targetKey: "lyric", label: "歌词", dirty: true,
      composing: false, canApply: true, error: null, version: session.getState(),
      focus: () => true, apply: () => "applied", discard: () => true });
    expect(await modals.confirm(modals.getSnapshot()!.id)).toBe(false);
    expect(await pending).toMatchObject({ status: "stale" });
    expect(session.getState().document).toBe(document);
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("其他草稿正在应用时禁止开始同步", async () => {
    const { session, cell, drafts, execute, command } = setup();
    let settle!: () => void;
    const pause = new Promise<void>((resolve) => { settle = resolve; });
    drafts.register({ id: "settings", kind: "settings", targetKey: "settings", label: "设置", dirty: true,
      composing: false, canApply: true, error: null, version: session.getState(),
      focus: () => true, apply: async () => { await pause; return "applied" as const; }, discard: () => true });
    const applying = drafts.request({ type: "apply", id: "settings" });
    expect(await execute(command)).toMatchObject({ status: "blocked" });
    settle(); await applying;
    expect(session.getState().selection?.anchor).toEqual(cell);
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("真实空窗组合拆分仍提交 TAB，一条历史且不制造简谱事件", async () => {
    const { session, measure, modals, execute, command } = setup(false, true);
    const pending = execute(command);
    expect(modals.getSnapshot()!.request.message).toContain("此范围为真实空窗");
    expect(modals.getSnapshot()!.request.message).toContain("新增 0 个空位");
    await modals.confirm(modals.getSnapshot()!.id);
    expect(await pending).toMatchObject({ status: "applied" });
    const state = session.getState();
    expect(state.document!.score.tracks[0]!.measures[0]!.beats).toHaveLength(measure.beats.length + 1);
    expect(state.document!.score.tracks[0]!.measures[0]!.numberedVoice.events).toEqual([]);
    expect(state.numberedSelection).toBeNull();
    expect(state.historyDepth.past).toBe(1);
  });
  it("切穿原音或命令版本过期在预览阶段阻止，不产生空历史", async () => {
    const { session, document, selection, execute, modals, command } = setup(true);
    const partial = buildTabNumberedSyncCommand(document, { ...selection, focus: selection.anchor }, "align");
    if (!partial.ok) throw new Error(partial.message);
    expect(await execute(partial.command)).toMatchObject({ status: "blocked" });
    expect(await execute({ ...command, expectedRevision: document.documentRevision + 1 })).toMatchObject({ status: "blocked" });
    expect(modals.getSnapshot()).toBeNull();
    expect(session.getState().document).toBe(document);
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("最终命令失败时两层均不写入，保留预览可取消", async () => {
    const { session, document, modals, execute, command } = setup();
    const pending = execute(command);
    const id = modals.getSnapshot()!.id;
    const commit = vi.spyOn(session.getState(), "execute").mockReturnValue(null);
    expect(await modals.confirm(id)).toBe(false);
    expect(session.getState().document).toBe(document);
    expect(session.getState().historyDepth.past).toBe(0);
    expect(modals.getSnapshot()?.error).toBeTruthy();
    modals.close(id, "cancel");
    expect(await pending).toMatchObject({ status: "cancelled" });
    commit.mockRestore();
  });
  it("带两段歌词的持久化 gap 显式细分，首段原词保留且新尾段无词", async () => {
    const { session, document, selection, modals, execute, command } = setup(true);
    const source = structuredClone(document);
    const event = source.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!;
    event.kind = "gap"; event.items = [];
    session.getState().replaceDocument(source);
    session.getState().setSelection(selection);
    const pending = execute(command);
    expect(modals.getSnapshot()!.request.message).toContain("保留 0 个已有音、2 处原词");
    await modals.confirm(modals.getSnapshot()!.id);
    expect(await pending).toMatchObject({ status: "applied" });
    const measure = session.getState().document!.score.tracks[0]!.measures[0]!;
    expect(measure.numberedVoice.events.map((item) => [item.kind, item.tick])).toEqual([["gap", 0], ["gap", 480]]);
    expect(measure.lyrics.every((lyric) => lyric.eventId === "sync-original")).toBe(true);
  });
  it("B 混合节奏预览准确标示两十六分与一八分，并完整保留第二原音", async () => {
    const { session, document, track, measure, cell, execute, modals } = setup(true);
    const source = structuredClone(document);
    const original = source.score.tracks[0]!.measures[0]!;
    original.numberedVoice.events[0]!.rhythm = { base: "eighth", dots: 0 };
    const second = { id: "sync-second", tick: 480, kind: "notes" as const, rhythm: { base: "eighth" as const, dots: 0 }, items: [{ id: "sync-second-item", token: "2" }] };
    original.numberedVoice.events.push(second);
    const split = applyScoreCommand(source, { type: C.SplitBeat, trackId: track.id, measureId: measure.id, beatId: cell.beatId });
    if (!split.ok) throw new Error(split.message);
    session.getState().replaceDocument(split.document);
    const beats = split.document.score.tracks[0]!.measures[0]!.beats;
    const selection = { anchor: cell, focus: { ...cell, beatId: beats[2]!.id } };
    session.getState().setSelection(selection);
    const built = buildTabNumberedSyncCommand(session.getState().document!, selection, "align");
    if (!built.ok) throw new Error(built.message);
    const pending = execute(built.command);
    const message = modals.getSnapshot()!.request.message;
    expect(message).toContain("缩短 1 个原简谱位置，新增 1 个空位");
    expect(message.match(/十六分音符/g)).toHaveLength(2);
    expect(message.match(/八分音符/g)).toHaveLength(1);
    await modals.confirm(modals.getSnapshot()!.id);
    expect(await pending).toMatchObject({ status: "applied" });
    const events = session.getState().document!.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(events.map((event) => [event.tick, event.rhythm.base])).toEqual([[0, "sixteenth"], [240, "sixteenth"], [480, "eighth"]]);
    expect(events[2]).toEqual(second);
    expect(session.getState().numberedSelection).toMatchObject({ eventId: events[1]!.id });
  });
  it("自身确认弹层只排除自身 surface guard，包含同步 open 订阅校验", async () => {
    const { session, modals, command } = setup();
    const checkedIds: (number | undefined)[] = [];
    const execute = createEditorCommandAdapter(session, modals, (_command, submission) => {
      checkedIds.push(submission?.confirmationModalId);
      const active = modals.getSnapshot();
      return active && active.id !== submission?.confirmationModalId ? "请先完成当前弹层。" : null;
    });
    const stop = modals.subscribe(() => modals.invalidate());
    const pending = execute(command);
    const modal = modals.getSnapshot()!;
    expect(modal).not.toBeNull();
    expect(checkedIds[0]).toBeUndefined();
    expect(checkedIds).toContain(modal.id);
    expect(await modals.confirm(modal.id)).toBe(true);
    expect(await pending).toMatchObject({ status: "applied" });
    expect(session.getState().historyDepth.past).toBe(1);
    stop();
  });
  it("调用方伪造或复用其他弹层 ID 无法排除守卫", async () => {
    const { session, modals, command, cell } = setup();
    const observed: (number | undefined)[] = [];
    const execute = createEditorCommandAdapter(session, modals, (_command, submission) => {
      observed.push(submission?.confirmationModalId);
      const active = modals.getSnapshot();
      return active && active.id !== submission?.confirmationModalId ? "其他弹层仍阻止提交。" : null;
    });
    const other = modals.open({ kind: "structure-impact", title: "其他确认", message: "其他确认" })!;
    expect(await execute(command, "modal", { confirmationModalId: other })).toMatchObject({ status: "blocked" });
    expect(await execute({ type: C.SetBeatKind, ...cell, kind: "rest" }, "modal", { confirmationModalId: other }))
      .toMatchObject({ status: "blocked" });
    expect(observed).toEqual([undefined, undefined]);
    modals.close(other, "cancel");
    const pending = execute(command, "modal", { confirmationModalId: other });
    const owned = modals.getSnapshot()!;
    modals.close(owned.id, "cancel");
    expect(await pending).toMatchObject({ status: "cancelled" });
    const replacement = modals.open({ kind: "structure-impact", title: "后来确认", message: "后来确认" })!;
    expect(owned.request.isValid?.()).toBe(false);
    expect(observed.at(-1)).toBeUndefined();
    expect(session.getState().historyDepth.past).toBe(0);
    modals.close(replacement, "cancel");
  });
});
