import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMNumberedEvent,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";
import { resolveEditorTieTarget, NUMBERED_TIE_SELECTION_REASON } from "../components/EditorShell/tools/editor-tie-target";
import { resolveQuickTechnique } from "../components/EditorShell/tools/editor-technique-target";
import { captureEditorToolIntent, editorToolSubmissionReason, isTabOnlyToolCommand } from "../components/EditorShell/tools/editor-tool-guard";
import { createEditorDraftCoordinator } from "../components/EditorShell/session/editor-draft-coordinator";
import { captureEditorVersion } from "../components/EditorShell/session/editor-session-version";
import { EditorToolbar } from "../components/EditorShell/workspace/EditorToolbar";
import { EditorSessionRuntime } from "../components/EditorShell/session/EditorSessionRuntime";
import { EditorStoreContext } from "../stores/editor-context";
import { createEditorSession } from "../stores/editor-store";

const setup = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures.find((m) => m.timeSignature.numerator === 4 && m.timeSignature.denominator === 4)!;
  measure.numberedVoice = { tuplets: [], events: Array.from({ length: 4 }, (_, i): ILXMNumberedEvent => ({
    id: `tie-event-${i}`, tick: i * 960, kind: "notes", rhythm: { base: "quarter", dots: 0 },
    items: [{ id: `tie-item-${i}`, token: "1" }],
  })) };
  measure.lyrics = [];
  track.numberedMarks = [];
  const range: MusicTextRange = { kind: "numbered", trackId: track.id,
    anchor: { measureId: measure.id, eventId: "tie-event-0" },
    focus: { measureId: measure.id, eventId: "tie-event-1" } };
  const active = { kind: "numbered" as const, trackId: track.id, measureId: measure.id, eventId: "tie-event-0" };
  const cell = { trackId: track.id, measureId: measure.id, beatId: measure.beats[0]!.id, string: 1 };
  const selection = { anchor: cell, focus: cell };
  return { document, track, measure, range, active, selection };
};

describe("简谱快捷延音线目标", () => {
  it("正反向显式双端点生成 item 引用，并可执行、移除及撤销重做", () => {
    const { document, track, range, active, selection } = setup();
    const result = resolveEditorTieTarget(document, selection, range, active);
    expect(result).toMatchObject({ kind: "numbered", ok: true, pressed: false,
      command: { type: "numbered.mark.add", trackId: track.id,
        mark: { type: "tie", fromItemId: "tie-item-0", toItemId: "tie-item-1" } } });
    expect(resolveEditorTieTarget(document, selection, { ...range, anchor: range.focus, focus: range.anchor }, null)).toEqual(result);
    if (!result.ok) throw new Error(result.message);
    const session = createEditorSession(document);
    expect(session.getState().execute(result.command)).toMatchObject({ ok: true, changed: true });
    const applied = session.getState().document!;
    const remove = resolveEditorTieTarget(applied, selection, range, active);
    expect(remove).toMatchObject({ ok: true, pressed: true, command: { type: "numbered.mark.remove" } });
    if (!remove.ok) throw new Error(remove.message);
    expect(session.getState().execute(remove.command)).toMatchObject({ ok: true, changed: true });
    expect(session.getState().document!.score.tracks[0]!.numberedMarks).toHaveLength(0);
    session.getState().undo();
    expect(session.getState().document).toEqual(applied);
    session.getState().redo();
    expect(session.getState().document!.score.tracks[0]!.numberedMarks).toHaveLength(0);
  });

  it("简谱单选不会使用残留 TAB 选区或自动寻找下一音", () => {
    const { document, selection, range, active } = setup();
    for (const currentRange of [null, { ...range, focus: range.anchor }]) {
      expect(resolveEditorTieTarget(document, selection, currentRange, active)).toEqual({
        kind: "numbered", ok: false, message: NUMBERED_TIE_SELECTION_REASON,
      });
    }
  });

  it("跨小节连接按音乐时间校验，反复边界禁止连接", () => {
    const { document, track, measure, range } = setup();
    const next = structuredClone(measure);
    next.id = "tie-next-measure";
    next.numberedVoice.events.forEach((event, i) => {
      event.id = `next-event-${i}`;
      event.items[0]!.id = `next-item-${i}`;
    });
    track.measures = [measure, next];
    measure.barline = "single";
    range.anchor.eventId = "tie-event-3";
    range.focus = { measureId: next.id, eventId: "next-event-0" };
    expect(resolveEditorTieTarget(document, null, range, null)).toMatchObject({ ok: true,
      command: { mark: { fromItemId: "tie-item-3", toItemId: "next-item-0" } } });
    measure.barline = "repeatEnd";
    expect(resolveEditorTieTarget(document, null, range, null)).toMatchObject({ ok: false,
      message: "简谱连接不能跨反复或终止边界" });
  });

  it("没有简谱范围或焦点时，完整保留 TAB resolver 规则", () => {
    const { document, selection } = setup();
    expect(resolveEditorTieTarget(document, selection, null, null)).toEqual({
      kind: "tab", ...resolveQuickTechnique(document, selection, "tie"),
    });
  });

  it.each(["pitch", "rest", "continuation", "gap", "chord", "three", "stale"])("拒绝非法端点或选区：%s", (variant) => {
    const { document, measure, range, active } = setup();
    if (variant === "pitch") measure.numberedVoice.events[1]!.items[0]!.token = "2";
    if (variant === "rest" || variant === "continuation") measure.numberedVoice.events[1]!.kind = variant;
    if (variant === "gap") measure.numberedVoice.events[1] = { ...measure.numberedVoice.events[1]!, kind: "gap", items: [] };
    const first = measure.numberedVoice.events[0]!;
    if (variant === "chord" && first.kind === "notes") first.items.push({ id: "second-member", token: "3" });
    if (variant === "three") range.focus.eventId = "tie-event-2";
    if (variant === "stale") range.focus.eventId = "missing-event";
    expect(resolveEditorTieTarget(document, null, range, active)).toMatchObject({ kind: "numbered", ok: false });
  });

  it("异音不会创建 slur；原有 slur 保持原样，还原号同音按核心规则接受", () => {
    const { document, track, measure, range, active } = setup();
    track.numberedMarks.push({ id: "slur", type: "slur", fromEventId: "tie-event-0", toEventId: "tie-event-1" });
    measure.numberedVoice.events[1]!.items[0]!.token = "2";
    expect(resolveEditorTieTarget(document, null, range, active)).toMatchObject({ ok: false, message: "简谱延音线两端音高须相同" });
    expect(track.numberedMarks).toEqual([{ id: "slur", type: "slur", fromEventId: "tie-event-0", toEventId: "tie-event-1" }]);
    measure.numberedVoice.events[1]!.items[0]!.token = "n1";
    expect(resolveEditorTieTarget(document, null, range, active)).toMatchObject({ ok: true, command: { mark: { type: "tie" } } });
  });

  it("简谱 mark 绕过 TAB-only guard，保留草稿和会话意图保护", () => {
    const { document, range, active, selection } = setup();
    const session = createEditorSession(document);
    session.getState().setSelection(selection);
    const drafts = createEditorDraftCoordinator(() => captureEditorVersion(session.getState()));
    const result = resolveEditorTieTarget(document, selection, range, active);
    if (!result.ok) throw new Error(result.message);
    expect(isTabOnlyToolCommand(result.command)).toBe(false);
    const intent = captureEditorToolIntent(session.getState, () => active);
    expect(editorToolSubmissionReason(session.getState(), active, drafts, result.command, { isCurrent: intent })).toBeNull();
    session.getState().setSelection(null);
    expect(editorToolSubmissionReason(session.getState(), active, drafts, result.command, { isCurrent: intent })).toBe("目标或文档已变化，请重新操作。");
    drafts.register({ id: "other", kind: "settings", targetKey: "settings", label: "设置", dirty: true,
      composing: false, canApply: false, error: null, version: captureEditorVersion(session.getState()),
      focus: () => true, discard: () => true, apply: () => "applied" });
    expect(editorToolSubmissionReason(session.getState(), active, drafts, result.command)).toBe("请先处理其他编辑草稿。");
  });
});

const findButton = (tree: ReactNode, label: string): Record<string, unknown> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findButton(child, label); if (found) return found; }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return null;
  return tree.props.label === label ? tree.props : findButton(tree.props.children as ReactNode, label);
};

const renderToolbar = (options: { single?: boolean; blocked?: boolean; numberedBlocked?: boolean; active?: boolean; tied?: boolean } = {}) => {
  const { document, track, range, active, selection } = setup();
  if (options.tied) track.numberedMarks.push({ id: "existing-tie", type: "tie", fromItemId: "tie-item-0", toItemId: "tie-item-1" });
  const session = createEditorSession(document);
  session.getState().setSelection(selection);
  const onAction = vi.fn(async () => true);
  const props: ComponentProps<typeof EditorToolbar> = {
    activeTarget: options.active === false ? null : active,
    continuousRange: options.single ? null : range,
    blocked: options.blocked ?? false, numberedBlocked: options.numberedBlocked ?? false,
    onAction, beforeAction: () => {}, execute: async () => ({ status: "cancelled", message: "test" }),
    onNavigate: () => "accepted", sidebarCollapsed: false, onToggleSidebar: () => {}, sidebarToggleRef: null,
  };
  let button: Record<string, unknown> | null = null;
  const Harness = () => { const tree = EditorToolbar(props); button = findButton(tree, "简谱延音线"); return tree; };
  const markup = renderToStaticMarkup(<EditorStoreContext.Provider value={{ ...session, getInitialState: session.getState }}>
    <EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime>
  </EditorStoreContext.Provider>);
  return { markup, button: button!, onAction, session };
};

describe("顶部简谱延音线入口", () => {
  it.each([true, false])("双端点支持 activeTarget 存在/已回谱面：%s", async (active) => {
    const { markup, button, onAction } = renderToolbar({ active });
    expect(markup).toContain('aria-label="简谱延音线"');
    expect(button.title).toBeUndefined();
    expect(button.availability).toMatchObject({ enabled: true });
    await (button.onClick as () => Promise<void>)();
    expect(onAction).toHaveBeenCalledWith({ type: "quickTechnique", technique: "tie" });
  });

  it("单选显示明确提示，点击不派发 TAB 动作", async () => {
    const { button, onAction } = renderToolbar({ single: true });
    expect(button.availability).toEqual({ enabled: false, reason: NUMBERED_TIE_SELECTION_REASON });
    await (button.onClick as () => Promise<void>)();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("已有同端点简谱延音线显示选中态，重复入口继续派发 toggle", async () => {
    const { markup, button, onAction } = renderToolbar({ tied: true });
    expect(button.pressed).toBe(true);
    expect(markup).toContain('aria-label="简谱延音线" aria-pressed="true"');
    await (button.onClick as () => Promise<void>)();
    expect(onAction).toHaveBeenCalledWith({ type: "quickTechnique", technique: "tie" });
  });

  it("简谱草稿锁保护入口，独立于 TAB 的编辑锁", async () => {
    const blocked = renderToolbar({ numberedBlocked: true });
    expect(blocked.button.availability).toMatchObject({ enabled: false });
    await (blocked.button.onClick as () => Promise<void>)();
    expect(blocked.onAction).not.toHaveBeenCalled();
    const numbered = renderToolbar({ blocked: true });
    expect(numbered.button.availability).toMatchObject({ enabled: true });
    await (numbered.button.onClick as () => Promise<void>)();
    expect(numbered.onAction).toHaveBeenCalledOnce();
  });
});
