import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_6_DOCUMENT, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { TupletToolDetails } from "../components/EditorShell/TupletToolDetails";
import { MusicTextSidebar } from "../components/EditorShell/MusicTextSidebar";
import { EditorSessionRuntime } from "../components/EditorShell/EditorSessionRuntime";
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
    expect(markup).toContain("3:2 · 3 个成员");
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
    expect(markup).toContain("待应用连音比例");
    expect(markup).toContain("删除当前连音组");
  });
});

const renderSidebar = (selected: boolean, tab?: "chord", numbered = false) => {
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
    }
    return tree;
  };
  return renderToStaticMarkup(<EditorStoreContext.Provider value={{ ...session, getInitialState: session.getState }}><EditorSessionRuntime session={session}><Harness /></EditorSessionRuntime></EditorStoreContext.Provider>);
};

describe("侧栏浏览与显式编辑分离", () => {
  it("初始无选区显示紧凑邀请，不显示禁用音符表单与任务切换", () => {
    const markup = renderSidebar(false);
    expect(markup).toContain("从谱面上的一个位置开始");
    expect(markup).toContain("查看歌曲设置");
    expect(markup).toContain("浏览小节工具");
    expect(markup).not.toContain('aria-label="选区任务"');
    expect(markup).not.toContain('aria-label="音符属性详情"');
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
