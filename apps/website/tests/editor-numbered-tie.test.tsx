import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildLayout,
  LXM_BARLINE_TYPES,
  type ILXMNumberedEvent,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { resolveNumberedArcOptions, NUMBERED_TIE_SELECTION_REASON } from "../../../packages/lxm-editor-react/src/EditorShell/tools/editor-tie-target";
import { NumberedArcTool } from "../../../packages/lxm-editor-react/src/EditorShell/tools/NumberedArcTool";
import { captureEditorToolIntent, editorToolSubmissionReason, isTabOnlyToolCommand } from "../../../packages/lxm-editor-react/src/EditorShell/tools/editor-tool-guard";
import { createEditorDraftCoordinator } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-draft-coordinator";
import { captureEditorVersion } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-session-version";
import { EditorToolbar } from "../../../packages/lxm-editor-react/src/EditorShell/workspace/EditorToolbar";
import { useScorePlayback } from "../../../packages/lxm-editor-react/src/EditorShell/playback/controller";
import { EditorSessionRuntime } from "../../../packages/lxm-editor-react/src/EditorShell/session/EditorSessionRuntime";
import { EditorStoreContext } from "../../../packages/lxm-editor-react/src/stores/editor-context";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";

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

describe("简谱快捷弧线目标", () => {
  it("正反向显式双端点生成 item 引用，并可执行、移除及撤销重做", () => {
    const { document, track, range } = setup();
    const { tie: result, slur, recommended } = resolveNumberedArcOptions(document, range);
    expect(recommended).toBe("tie");
    expect(slur).toMatchObject({ ok: true, command: { mark: { type: "slur" } } });
    expect(result).toMatchObject({ ok: true, pressed: false,
      command: { type: "numbered.mark.add", trackId: track.id,
        mark: { type: "tie", fromItemId: "tie-item-0", toItemId: "tie-item-1" } } });
    expect(resolveNumberedArcOptions(document, { ...range, anchor: range.focus, focus: range.anchor }).tie).toEqual(result);
    if (!result.ok) throw new Error(result.message);
    const session = createEditorSession(document);
    expect(session.getState().execute(result.command)).toMatchObject({ ok: true, changed: true });
    const applied = session.getState().document!;
    const remove = resolveNumberedArcOptions(applied, range).tie;
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
    const { document, range } = setup();
    for (const currentRange of [null, { ...range, focus: range.anchor }]) {
      expect(resolveNumberedArcOptions(document, currentRange)).toMatchObject({
        tie: { ok: false, message: NUMBERED_TIE_SELECTION_REASON }, slur: { ok: false }, recommended: null,
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
    expect(resolveNumberedArcOptions(document, range).tie).toMatchObject({ ok: true,
      command: { mark: { fromItemId: "tie-item-3", toItemId: "next-item-0" } } });
    measure.barline = "repeatEnd";
    expect(resolveNumberedArcOptions(document, range).tie).toMatchObject({ ok: false,
      message: "简谱连接不能跨反复或终止边界" });

    next.numberedVoice.events[0]!.items[0]!.token = "2";
    for (const barline of LXM_BARLINE_TYPES) {
      measure.barline = barline;
      expect(resolveNumberedArcOptions(document, range).slur).toMatchObject(
        barline === "single" || barline === "double"
          ? { ok: true, command: { mark: { type: "slur", fromEventId: "tie-event-3", toEventId: "next-event-0" } } }
          : { ok: false, message: "简谱连接不能跨反复或终止边界" },
      );
    }
  });

  it.each(["rest", "continuation", "gap", "silence", "chord", "stale"])("拒绝非法端点或选区：%s", (variant) => {
    const { document, measure, range } = setup();
    measure.numberedVoice.events[1]!.items[0]!.token = "2";
    if (variant === "rest" || variant === "continuation") measure.numberedVoice.events[1]!.kind = variant;
    if (variant === "gap") measure.numberedVoice.events[1] = { ...measure.numberedVoice.events[1]!, kind: "gap", items: [] };
    const first = measure.numberedVoice.events[0]!;
    if (variant === "silence") first.rhythm = { base: "eighth", dots: 0 };
    if (variant === "chord" && first.kind === "notes") first.items.push({ id: "second-member", token: "3" });
    if (variant === "stale") range.focus.eventId = "missing-event";
    expect(resolveNumberedArcOptions(document, range)).toMatchObject({ tie: { ok: false }, slur: { ok: false }, recommended: null });
  });

  it("多音乐句含重复音时推荐圆滑线，并保留各音时值", () => {
    const { document, measure, range } = setup();
    measure.numberedVoice.events.forEach((event, index) => { event.items[0]!.token = index < 2 ? "6." : "5."; });
    range.focus.eventId = "tie-event-2";
    const { tie, slur, recommended } = resolveNumberedArcOptions(document, range);
    expect(tie.ok).toBe(false);
    expect(recommended).toBe("slur");
    expect(slur).toMatchObject({ ok: true, command: { mark: { type: "slur", fromEventId: "tie-event-0", toEventId: "tie-event-2" } } });
    if (!slur.ok) throw new Error(slur.message);
    const session = createEditorSession(document);
    expect(session.getState().execute(slur.command)).toMatchObject({ ok: true, changed: true });
    expect(session.getState().document!.score.tracks[0]!.measures.find((m) => m.id === measure.id)?.numberedVoice).toEqual(measure.numberedVoice);
  });

  it("旧谱已有跨休止符的圆滑线仍可移除", () => {
    const { document, track, measure, range } = setup();
    measure.numberedVoice.events[1]!.kind = "rest";
    range.focus.eventId = "tie-event-2";
    expect(resolveNumberedArcOptions(document, range).slur).toEqual({ ok: false, message: "选区含休止符" });
    track.numberedMarks.push({ id: "legacy-slur", type: "slur", fromEventId: "tie-event-0", toEventId: "tie-event-2" });
    expect(resolveNumberedArcOptions(document, range).slur).toMatchObject({
      ok: true, pressed: true, command: { type: "numbered.mark.remove", markId: "legacy-slur" },
    });
  });

  it("同音沿用延音线，还原号不改变同音判断", () => {
    const { document, track, measure, range } = setup();
    track.numberedMarks.push({ id: "slur", type: "slur", fromEventId: "tie-event-0", toEventId: "tie-event-1" });
    measure.numberedVoice.events[1]!.items[0]!.token = "n1";
    expect(resolveNumberedArcOptions(document, range)).toMatchObject({ recommended: "tie", tie: { ok: true, command: { mark: { type: "tie" } } }, slur: { ok: true, pressed: true } });
  });

  it("普通小节线两侧的 6. 和 5. 可画出圆滑线、移除并撤销重做", () => {
    const { document, track, measure, range } = setup();
    const next = track.measures[track.measures.indexOf(measure) + 1]!;
    const from = measure.numberedVoice.events.at(-1)!;
    from.items[0]!.token = "6.";
    measure.barline = "single";
    next.numberedVoice = { tuplets: [], events: [{
      id: "slur-next-event", tick: 0, kind: "notes", rhythm: { base: "quarter", dots: 0 },
      items: [{ id: "slur-next-item", token: "5." }],
    }] };
    next.lyrics = [];
    range.anchor = { measureId: next.id, eventId: "slur-next-event" };
    range.focus = { measureId: measure.id, eventId: from.id };

    const session = createEditorSession(document);
    const resolve = () => resolveNumberedArcOptions(session.getState().document!, range).slur;
    const add = resolve();
    const mark = { type: "slur", fromEventId: from.id, toEventId: "slur-next-event" };
    expect(add).toMatchObject({ ok: true, pressed: false,
      command: { type: "numbered.mark.add", mark } });
    if (!add.ok) throw new Error(add.message);
    expect(session.getState().execute(add.command)).toMatchObject({ ok: true, changed: true });
    const applied = session.getState().document!;
    const [saved] = applied.score.tracks[0]!.numberedMarks;
    expect(saved).toMatchObject(mark);
    expect(buildLayout(applied).systems.flatMap(system => system.numberedMarks ?? []))
      .toContainEqual(expect.objectContaining({ markId: saved!.id, type: "slur" }));

    session.getState().undo();
    expect(resolve()).toMatchObject({ ok: true, pressed: false });
    session.getState().redo();
    const remove = resolve();
    expect(remove).toMatchObject({ ok: true, pressed: true,
      command: { type: "numbered.mark.remove", markId: saved!.id } });
    if (!remove.ok) throw new Error(remove.message);
    expect(session.getState().execute(remove.command)).toMatchObject({ ok: true, changed: true });
    expect(resolve()).toMatchObject({ ok: true, pressed: false });
    session.getState().undo();
    expect(session.getState().document).toEqual(applied);
    session.getState().redo();
    expect(resolve()).toMatchObject({ ok: true, pressed: false });
  });

  it("简谱 mark 绕过 TAB-only guard，保留草稿和会话意图保护", () => {
    const { document, range, active, selection } = setup();
    const session = createEditorSession(document);
    session.getState().setSelection(selection);
    const drafts = createEditorDraftCoordinator(() => captureEditorVersion(session.getState()));
    const result = resolveNumberedArcOptions(document, range).tie;
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

type ArcToolProps = ComponentProps<typeof NumberedArcTool>;

const findArcTool = (tree: ReactNode): ArcToolProps | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findArcTool(child); if (found) return found; }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return null;
  if (tree.type === NumberedArcTool) return tree.props as ArcToolProps;
  return findArcTool(tree.props.children as ReactNode) ?? findArcTool(tree.props.quickTechniques as ReactNode);
};

const renderToolbar = (options: { single?: boolean; blocked?: boolean; numberedBlocked?: boolean; active?: boolean; differentPitch?: boolean; slurred?: boolean } = {}) => {
  const { document, track, measure, range, active, selection } = setup();
  if (options.differentPitch) measure.numberedVoice.events[1]!.items[0]!.token = "2";
  if (options.slurred) track.numberedMarks.push({ id: "existing-slur", type: "slur", fromEventId: "tie-event-0", toEventId: "tie-event-1" });
  const session = createEditorSession(document);
  session.getState().setSelection(selection);
  const onAction = vi.fn(async () => true);
  const props: Omit<ComponentProps<typeof EditorToolbar>, "playback" | "isPlaybackEntryBlocked"> = {
    activeTarget: options.active === false ? null : active,
    continuousRange: options.single ? null : range,
    blocked: options.blocked ?? false, numberedBlocked: options.numberedBlocked ?? false,
    onAction, beforeAction: () => {}, execute: async () => ({ status: "cancelled", message: "test" }),
    onNavigate: () => "accepted", sidebarCollapsed: false, onToggleSidebar: () => {}, sidebarToggleRef: null,
    onOpenRepeatEnding: () => false, onOpenJumpMarks: () => false, onOpenMeasureRepeat: () => false,
    onRepairJumpMark: vi.fn(), onRepairRepeatEnding: vi.fn(),
  };
  let tool: ArcToolProps | null = null;
  const Harness = () => { const tree = EditorToolbar({ ...props, playback: useScorePlayback(document), isPlaybackEntryBlocked: () => false }); tool = findArcTool(tree); return tree; };
  const markup = renderToStaticMarkup(<EditorStoreContext.Provider value={{ ...session, getInitialState: session.getState }}>
    <EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime>
  </EditorStoreContext.Provider>);
  return { markup, tool: tool!, onAction };
};

describe("顶部简谱弧线入口", () => {
  it.each([true, false])("双端点支持 activeTarget 存在/已回谱面：%s", async (active) => {
    const { markup, tool, onAction } = renderToolbar({ active });
    expect(markup).toContain('aria-label="简谱弧线"');
    expect(tool.options.recommended).toBe("tie");
    await tool.onApply("slur");
    expect(onAction).toHaveBeenCalledWith({ type: "numberedArc", kind: "slur" });
  });

  it("简谱单选仍可打开气泡查看选区条件", () => {
    const { tool } = renderToolbar({ single: true });
    expect(tool.blocked).toBe(false);
    expect(tool.options.tie).toEqual({ ok: false, message: NUMBERED_TIE_SELECTION_REASON });
    expect(tool.options.slur.ok).toBe(false);
  });

  it("只有 TAB 目标时仍显示直接操作的延音线入口", () => {
    const { markup, tool } = renderToolbar({ single: true, active: false });
    expect(tool).toBeNull();
    expect(markup).toContain('aria-label="延音线"');
  });

  it.each([false, true])("异音推荐圆滑线，已有记号时提供移除命令：%s", (slurred) => {
    const { tool } = renderToolbar({ differentPitch: true, slurred, active: false });
    expect(tool.options.tie.ok).toBe(false);
    expect(tool.options.recommended).toBe("slur");
    expect(tool.options.slur).toMatchObject({ ok: true, pressed: slurred });
  });

  it("简谱草稿锁保护入口，独立于 TAB 的编辑锁", async () => {
    const blocked = renderToolbar({ numberedBlocked: true });
    expect(blocked.tool.blocked).toBe(true);
    await blocked.tool.onApply("tie");
    expect(blocked.onAction).not.toHaveBeenCalled();
    const numbered = renderToolbar({ blocked: true });
    expect(numbered.tool.blocked).toBe(false);
    await numbered.tool.onApply("tie");
    expect(numbered.onAction).toHaveBeenCalledOnce();
  });
});
