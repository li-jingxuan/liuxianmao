import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { EditorToolbar } from "../components/EditorShell/EditorToolbar";
import { EditorSessionRuntime } from "../components/EditorShell/EditorSessionRuntime";
import { EditorStoreContext } from "../stores/editor-context";
import { createEditorSession } from "../stores/editor-store";

const findButton = (
  tree: ReactNode,
  label: string,
): Record<string, unknown> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return null;
  if (tree.props.label === label) return tree.props;
  return findButton(tree.props.children as ReactNode, label);
};

const renderToolbar = ({
  dots = 0,
  blocked = false,
  multi = false,
  numbered = false,
  lyric = false,
  noSelection = false,
}: {
  dots?: 0 | 1 | 2;
  blocked?: boolean;
  multi?: boolean;
  numbered?: boolean;
  lyric?: boolean;
  noSelection?: boolean;
} = {}) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures.find(
    (item) =>
      !item.tuplets.length &&
      !item.numberedVoice.tuplets.length &&
      item.beats.length > 1,
  )!;
  const session = createEditorSession(document);
  const anchor = {
    trackId: track.id,
    measureId: measure.id,
    beatId: measure.beats[0]!.id,
    string: 1,
  };
  // 通过真实命令准备附点状态，TAB 缩短时由引擎补齐休止，保持小节完整。
  expect(
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetBeatRhythm,
        ...anchor,
        rhythm: { base: "eighth", dots: numbered ? 0 : dots },
      })?.ok,
  ).toBe(true);
  expect(
    session
      .getState()
      .execute({
        type: "numbered.event.setRhythm",
        trackId: track.id,
        measureId: measure.id,
        eventId: measure.numberedVoice.events[0]!.id,
        rhythm: { base: "eighth", dots },
        timeline: "editTimeline",
      })?.ok,
  ).toBe(true);
  session
    .getState()
    .setSelection(
      noSelection
        ? null
        : {
            anchor,
            focus: multi ? { ...anchor, beatId: measure.beats[1]!.id } : anchor,
          },
    );
  const onAction = vi.fn(async () => true);
  const target = {
    trackId: track.id,
    measureId: measure.id,
    eventId: measure.numberedVoice.events[0]!.id,
  };
  const props: ComponentProps<typeof EditorToolbar> = {
    sidebarCollapsed: false,
    onToggleSidebar: () => {},
    sidebarToggleRef: null,
    activeTarget: lyric
      ? { ...target, kind: "lyric", verse: 1 }
      : numbered
        ? { ...target, kind: "numbered" }
        : null,
    blocked,
    numberedBlocked: blocked,
    onAction,
    beforeAction: () => {},
    execute: async () => ({ status: "cancelled", message: "test" }),
    onNavigate: () => "accepted",
  };
  let single: Record<string, unknown> | null = null;
  let double: Record<string, unknown> | null = null;
  const Harness = () => {
    const tree = EditorToolbar(props);
    single = findButton(tree, "单附点");
    double = findButton(tree, "双附点");
    return tree;
  };
  const markup = renderToStaticMarkup(
    <EditorStoreContext.Provider
      value={{ ...session, getInitialState: session.getState }}
    >
      <EditorSessionRuntime session={session}>
        <Harness />
      </EditorSessionRuntime>
    </EditorStoreContext.Provider>,
  );
  return { markup, onAction, single: single!, double: double! };
};

describe("工具栏附点快捷入口", () => {
  it.each([1, 2] as const)(
    "从普通时值选择 %i 个附点，入口带可访问选中态",
    (dots) => {
      const { markup, onAction, single, double } = renderToolbar();
      expect(markup).toContain('aria-label="六线谱附点"');
      expect(markup).toMatch(/aria-label="单附点" aria-pressed="false"/);
      expect(markup).toMatch(/aria-label="双附点" aria-pressed="false"/);
      const button = dots === 1 ? single : double;
      expect(button.availability).toMatchObject({ enabled: true });
      (button.onClick as () => void)();
      expect(onAction).toHaveBeenCalledWith({ type: "dots", dots });
    },
  );

  it.each([1, 2] as const)(
    "已选 %i 个附点时重复点击取消，另一入口可直接切换",
    (dots) => {
      const { onAction, single, double } = renderToolbar({ dots });
      const selected = dots === 1 ? single : double;
      const other = dots === 1 ? double : single;
      expect(selected.pressed).toBe(true);
      expect(other.pressed).toBe(false);
      (selected.onClick as () => void)();
      expect(onAction).toHaveBeenLastCalledWith({ type: "dots", dots: 0 });
      (other.onClick as () => void)();
      expect(onAction).toHaveBeenLastCalledWith({
        type: "dots",
        dots: dots === 1 ? 2 : 1,
      });
    },
  );

  it("简谱读取自身附点，保留的 TAB 选区不影响选中态", () => {
    const { markup, single, double, onAction } = renderToolbar({
      numbered: true,
      dots: 2,
    });
    expect(markup).toContain('aria-label="简谱附点"');
    expect(single.pressed).toBe(false);
    expect(double.pressed).toBe(true);
    (double.onClick as () => void)();
    expect(onAction).toHaveBeenCalledWith({ type: "dots", dots: 0 });
  });

  it.each([
    { blocked: true },
    { multi: true },
    { lyric: true },
    { noSelection: true },
    { numbered: true, blocked: true },
  ])("不可编辑目标 %j 拒绝附点操作", (options) => {
    const { single, double, onAction } = renderToolbar(options);
    for (const button of [single, double]) {
      expect(button.availability).toMatchObject({ enabled: false });
      (button.onClick as () => void)();
    }
    expect(onAction).not.toHaveBeenCalled();
  });
});
