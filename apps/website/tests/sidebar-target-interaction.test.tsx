import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_6_DOCUMENT, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { TupletToolDetails } from "../components/EditorShell/tools/TupletToolDetails";
import { NoteToolDetails } from "../components/EditorShell/tools/NoteToolDetails";
import { MeasureToolDetails } from "../components/EditorShell/tools/MeasureToolDetails";
import { MusicTextSidebar } from "../components/EditorShell/music-text/MusicTextSidebar";
import { EditorSessionRuntime } from "../components/EditorShell/session/EditorSessionRuntime";
import { createEditorSession } from "../stores/editor-store";
import { EditorStoreContext } from "../stores/editor-context";

const find = (tree: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return null;
  if (predicate(tree.props)) return tree.props;
  return find(tree.props.children as ReactNode, predicate);
};

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const focus = { trackId: track.id, measureId: measure.id, beatId: measure.beats[0]!.id, string: 1 };
  return { document, track, measure, selection: { anchor: focus, focus } };
};

describe("简谱连音入口的真实目标", () => {
  it("简谱选区显示实际组并删除独立声部连音，保留的TAB选区不参与", async () => {
    const { document, track, measure, selection } = fixture();
    const event = measure.numberedVoice.events[0]!;
    measure.numberedVoice.tuplets = [{ id: "numbered-group", eventIds: measure.numberedVoice.events.slice(0, 3).map((item) => item.id), ratio: { actual: 3, normal: 2 } }];
    const execute = vi.fn(async (_command: ILXMScoreCommand) => ({ status: "cancelled" as const, message: "test" }));
    let remove: (() => void) | undefined;
    const Harness = () => {
      const tree = TupletToolDetails({ document, selection, numberedSelection: { kind: "numberedEvent", trackId: track.id, measureId: measure.id, eventId: event.id }, blocked: false, execute });
      const button = find(tree, (props) => props.children === "删除当前简谱连音组");
      expect(button?.disabled).toBe(false);
      remove = button?.onClick as () => void;
      return tree;
    };
    const markup = renderToStaticMarkup(<Harness />);
    expect(markup).toContain("三连音 · 3 个成员");
    expect(markup).not.toContain("待应用连音比例");
    remove!();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledWith({ type: "numbered.tuplet.remove", trackId: track.id, measureId: measure.id, tupletId: "numbered-group" });
  });

  it("合法简谱空窗只路由到独立节奏表单，不显示TAB比例", () => {
    const { document, track, measure, selection } = fixture();
    const edit = vi.fn();
    const target = { kind: "numberedTime" as const, trackId: track.id, measureId: measure.id, tick: 0, endTick: 480 };
    let open: (() => void) | undefined;
    const Harness = () => {
      const tree = TupletToolDetails({ document, selection, numberedSelection: target, blocked: false, execute: async () => ({ status: "cancelled", message: "test" }), onEditNumberedRhythm: edit });
      open = find(tree, (props) => props.children === "编辑简谱节奏与范围")?.onClick as () => void;
      expect(find(tree, (props) => props.children === "删除当前简谱连音组")?.disabled).toBe(true);
      return tree;
    };
    expect(renderToStaticMarkup(<Harness />)).not.toContain("待应用连音比例");
    open!();
    expect(edit).toHaveBeenCalledWith({ ...target, kind: "numbered" });
  });

  it("无简谱选区时仍保留TAB六种连音比例", () => {
    const { document, selection } = fixture();
    const markup = renderToStaticMarkup(<TupletToolDetails document={document} selection={selection} blocked={false} execute={async () => ({ status: "cancelled", message: "test" })} />);
    expect(markup).toContain("连音类型");
    expect(markup).toContain("删除当前连音组");
  });
});

const renderSidebar = (selected: boolean, tab?: "chord" | "song", numbered = false, task?: "measure") => {
  const { document, selection, track, measure } = fixture();
  const session = createEditorSession(document);
  if (selected) session.getState().setSelection(selection);
  if (numbered) session.getState().setNumberedSelection({ kind: "numberedEvent", trackId: track.id, measureId: measure.id, eventId: measure.numberedVoice.events[0]!.id });
  const noop = () => {};
  const props: ComponentProps<typeof MusicTextSidebar> = {
    ref: null, onOpen: noop, onEditingChange: noop, onPopoverHiddenChange: noop,
    onNumberedActionBlockedChange: noop, onTargetChange: noop, onScoreFocus: noop,
    onScoreSelection: noop, getNumberedBeatEventIds: () => [], getFloatingAnchor: () => null,
    getFloatingViewport: () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }),
    onToolAction: async () => false, executeTool: async () => ({ status: "cancelled", message: "test" }),
  };
  let switched = false;
  const Harness = () => {
    const tree = MusicTextSidebar(props);
    if (tab && !switched) {
      switched = true;
      const tabs = find(tree, (value) => value.activeKey === "selection" && Array.isArray(value.items));
      (tabs!.onChange as (key: string) => void)(tab);
      return tree;
    }
    if (task && !switched) {
      switched = true;
      const tasks = find(tree, (value) => value["aria-label"] === "选区任务");
      (tasks!.onChange as (key: string) => void)(task);
      return tree;
    }
    const activeSurface = tab === "song" ? "song" : task && selected ? "measure" : null;
    const settings = find(tree, (value) => "activeSurface" in value);
    expect(settings?.activeSurface).toBe(activeSurface);
    const actions = find(tree, (value) => "data-editor-actions-host" in value);
    expect(actions?.hidden).toBe(activeSurface === null);
    return tree;
  };
  return renderToStaticMarkup(<EditorStoreContext.Provider value={{ ...session, getInitialState: session.getState }}><EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime></EditorStoreContext.Provider>);
};

describe("侧栏浏览与显式编辑分离", () => {
  it("初始无选区显示紧凑邀请，不显示禁用音符表单与任务切换", () => {
    const markup = renderSidebar(false);
    expect(markup).toContain("点击谱面中的音符或小节开始编辑");
    for (const label of ["前往谱面选择", "浏览简谱与歌词", "查看歌曲设置", "浏览小节工具", "原编辑位置已失效"]) expect(markup).not.toContain(label);
    expect(markup).not.toContain('aria-label="选区任务"');
    expect(markup).not.toContain('aria-label="音符属性详情"');
  });

  it("真实歌曲和小节表单保留设置操作表面", () => {
    renderSidebar(false, "song");
    renderSidebar(true, undefined, false, "measure");
  });

  it("已有TAB选区仅浏览和弦页签时保持显式编辑入口", () => {
    const markup = renderSidebar(true, "chord");
    expect(markup).toContain("编辑当前拍和弦");
    expect(markup).not.toContain('aria-label="和弦名称"');
    expect(markup).not.toContain("当前内容已应用");
  });

  it("当前简谱选区不能把仍保留的TAB拍点作为和弦默认目标", () => {
    const markup = renderSidebar(true, "chord", true);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*><span>编辑当前拍和弦<\/span>/);
    expect(markup).not.toContain('aria-label="和弦名称"');
  });
});

describe("紧凑选区详情的即时命令", () => {
  it("附点与音符状态通过原动作提交，并移除 TAB 下方的旧功能块", () => {
    const { document, selection, measure } = fixture();
    measure.beats[0]!.notes = [{ id: "note-x", string: 1, fret: "x" }];
    const action = vi.fn(async () => true);
    let tree: ReactNode;
    const Harness = () => {
      tree = NoteToolDetails({ document, selection, blocked: false, onAction: action });
      return tree;
    };
    const markup = renderToStaticMarkup(<Harness />);
    expect(markup).toMatch(/aria-label="弹奏标记"[^>]*aria-pressed="true"/);
    for (const label of ["延续一拍", "编辑此拍和弦", "演奏技巧", "删除所选弦音符"]) expect(markup).not.toContain(label);
    for (const [label, command] of [["复附点", { type: "dots", dots: 2 }], ["弹奏标记", { type: "muted" }], ["延音标记", { type: "continuation" }], ["整拍休止", { type: "rest" }]] as const) {
      const button = find(tree!, (props) => props["aria-label"] === label && typeof props.onClick === "function");
      expect(button?.disabled).toBe(false);
      (button!.onClick as () => void)();
      expect(action).toHaveBeenLastCalledWith(command);
    }
  });

  it("多拍禁用时值和附点，并提供可聚焦的原因提示", () => {
    const { document, selection, measure } = fixture();
    selection.focus = { ...selection.focus, beatId: measure.beats[1]!.id };
    const markup = renderToStaticMarkup(<NoteToolDetails document={document} selection={selection} blocked={false} onAction={async () => true} />);
    for (const label of ["四分音符", "无附点", "附点", "复附点"]) {
      expect(markup).toMatch(new RegExp(`<span[^>]*tabindex="0"[^>]*aria-label="${label}"`));
      expect(markup).toMatch(new RegExp(`<button[^>]*aria-label="${label}"[^>]*disabled`));
    }
  });

  it.each([false, true])("混合/全部休止保留恢复动作（全部=%s）", (all) => {
    const { document, selection, measure } = fixture();
    measure.beats[0]!.kind = "rest";
    measure.beats[0]!.notes = [];
    selection.focus = { ...selection.focus, beatId: measure.beats[1]!.id };
    measure.beats[1]!.kind = all ? "rest" : "notes";
    if (all) measure.beats[1]!.notes = [];
    const action = vi.fn(async () => true);
    const Harness = () => {
      const tree = NoteToolDetails({ document, selection, blocked: false, onAction: action });
      const restore = find(tree, (props) => all ? props["aria-label"] === "取消休止" && typeof props.onClick === "function" : props.children === "取消选区休止");
      expect(restore?.disabled).toBe(false);
      (restore!.onClick as () => void)();
      return tree;
    };
    renderToStaticMarkup(<Harness />);
    expect(action).toHaveBeenCalledWith({ type: "restore" });
  });

  it("末小节仅禁用开始/双向反复，符号保留名字与选中态", () => {
    const { document, track, selection } = fixture();
    const measure = track.measures.at(-1)!;
    const action = vi.fn(async () => true);
    const Harness = () => {
      const tree = MeasureToolDetails({ document, selection, target: { trackId: track.id, measureId: measure.id }, blocked: false, onAction: action, navigate: () => {} });
      for (const label of ["开始反复线", "双向反复线"]) expect(find(tree, (props) => props["aria-label"] === label)?.disabled).toBe(true);
      const single = find(tree, (props) => props["aria-label"] === "单小节线");
      expect(single?.disabled).toBe(false);
      (single!.onClick as () => void)();
      return tree;
    };
    const markup = renderToStaticMarkup(<Harness />);
    expect(markup).not.toContain("ant-alert");
    expect(markup).toContain("谱尾右边界没有下一小节，不能开始反复");
    expect(action).toHaveBeenCalledWith({ type: "barline", value: "single", target: { trackId: track.id, measureId: measure.id } });
  });
});
