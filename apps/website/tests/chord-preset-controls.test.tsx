import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Dropdown, Input } from "antd";
import { CURRENT_SCHEMA_VERSION, SCORE_DOCUMENT_SCHEMA, type ILXMDocument } from "@liuxianmao/lxm-editor";
import { ChordPresetControls } from "../components/EditorShell/chords/ChordPresetControls";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  refs: [] as { current: unknown }[],
  refsIndex: 0,
  stateIndex: 0,
  text: "",
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T,>(initial: T | (() => T)) => [
    harness.stateIndex++ === 1 ? harness.text : typeof initial === "function" ? (initial as () => T)() : initial,
    vi.fn(),
  ],
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    harness.refs[harness.refsIndex++] = ref;
    return ref;
  },
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
}));
vi.mock("../components/EditorShell/chords/chord-catalog-resource", () => ({
  chordCatalogResource: {
    subscribe: vi.fn(),
    getSnapshot: () => ({ status: "ready", catalog: null, error: null }),
    ensureLoaded: vi.fn(),
  },
}));
type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const descendants = (node: ReactNode): Element[] =>
  Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as Element;
    return [element, ...descendants(element.props.children)];
  });
const key = (value: string, extra: Record<string, unknown> = {}) => ({
  key: value,
  repeat: false,
  nativeEvent: { isComposing: false, keyCode: 0 },
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...extra,
});
const committed = (tonic: string | null, mode: "major" | "minor" = "major"): ILXMDocument => ({
  schema: SCORE_DOCUMENT_SCHEMA, schemaVersion: CURRENT_SCHEMA_VERSION, documentRevision: 0,
  score: { id: "score", title: "song", arranger: "", keySignature: "C", tracks: [],
    meta: tonic ? { "lxm:tonality": { version: 1, tonic, mode, ...(mode === "minor" ? { minorTonicDegree: 6 } : {}) } } : {} },
});
function view(options: { document?: ILXMDocument; text?: string } = {}) {
  harness.effects = [];
  harness.refs = [];
  harness.refsIndex = 0;
  harness.stateIndex = 0;
  harness.text = options.text ?? "";
  const onOpenLibrary = vi.fn(),
    onOpenSettings = vi.fn();
  const tree = ChordPresetControls({
    draft: { display: "name", chord: { name: "Bm", diagram: null } },
    onChange: vi.fn(),
    presetsEnabled: true,
    presentation: "quick",
    menuOpen: true,
    onOpenLibrary,
    onOpenSettings,
    document: options.document,
  });
  const elements = descendants(tree),
    dropdown = elements.find((element) => element.type === Dropdown)!;
  const popup = (dropdown.props.popupRender as () => Element)();
  const nodes = descendants(popup),
    trigger = elements.find(
      (element) =>
        element.type === Button && element.props["aria-label"] === "更多和弦",
    )!;
  const search = nodes.find((element) => element.type === Input)!;
  const capture = tree.props.onKeyDownCapture as (
    event: ReturnType<typeof key>,
  ) => void;
  const bubble = popup.props.onKeyDown as (
    event: ReturnType<typeof key>,
  ) => void;
  return {
    tree,
    nodes,
    trigger,
    search,
    popup,
    capture,
    bubble,
    onOpenLibrary,
    onOpenSettings,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("更多和弦键盘交互", () => {
  it.each([
    [committed("C"), "", "C大调·和弦推荐"],
    [committed("A", "minor"), "", "A小调·和弦推荐"],
    [committed(null), "", "常用和弦推荐"],
    [undefined, "", "常用和弦推荐"],
    [committed("C"), "Bm", "搜索结果"],
    [committed(null), "Bm", "搜索结果"],
    [committed("C"), "  ", "C大调·和弦推荐"],
  ])("更多主标题根据已提交调性和搜索显示，移除设置行 %#", (document, text, title) => {
    const value = view({ document, text });
    expect(value.nodes.filter(node => node.type === "strong").map(node => node.props.children)).toEqual([title]);
    const allNodes = [...descendants(value.tree), ...value.nodes];
    expect(allNodes.some(node => node.type === Button && node.props.children === "设置调性")).toBe(false);
    expect(allNodes.some(node => node.type === "strong" && String(node.props.children).startsWith("曲谱"))).toBe(false);
    expect(value.nodes.find(node => node.props["aria-label"] === "和弦库")).toBeDefined();
    expect(value.onOpenSettings).not.toHaveBeenCalled();
  });
  it("搜索 Enter 只阻止默认行为，箭头将焦点明确移动到可选按钮", () => {
    const value = view(),
      event = key("Enter");
    (value.search.props.onKeyDown as (event: ReturnType<typeof key>) => void)(
      event,
    );
    value.bubble(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(value.onOpenLibrary).not.toHaveBeenCalled();
    const input = { focus: vi.fn() },
      candidate = { focus: vi.fn() };
    vi.stubGlobal("document", { activeElement: input });
    const down = key("ArrowDown", {
      currentTarget: { querySelectorAll: () => [input, candidate] },
    });
    value.bubble(down);
    expect(candidate.focus).toHaveBeenCalledOnce();
    const activation = key("Enter");
    value.capture(activation);
    value.bubble(activation);
    expect(activation.preventDefault).not.toHaveBeenCalled();
    expect(activation.stopPropagation).toHaveBeenCalledOnce();
  });
  it("Escape 关闭菜单并聚焦自身更多按钮，不依赖 Sidebar 的 aria 查询", () => {
    const value = view(),
      focus = vi.fn();
    (value.trigger.props.ref as { current: unknown }).current = { focus };
    const event = key("Escape");
    value.capture(event);
    value.bubble(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
  it.each(["Enter", " ", "Escape"])(
    "重复 %s 在捕获阶段被阻止，不产生连续选择或导航",
    (name) => {
      const value = view(),
        event = key(name, { repeat: true });
      value.capture(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(value.onOpenLibrary).not.toHaveBeenCalled();
      expect(value.onOpenSettings).not.toHaveBeenCalled();
    },
  );
  it("共用 composition helper 的组合及 cooling 保护，卸载清理计时器", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const value = view();
    const effectCleanups = harness.effects
      .map((effect) => effect())
      .filter(
        (cleanup): cleanup is () => void => typeof cleanup === "function",
      );
    const start = value.popup.props.onCompositionStart as () => void,
      end = value.popup.props.onCompositionEnd as () => void;
    const library = value.nodes.find(
      (node) => node.type === Button && node.props["aria-label"] === "和弦库",
    )!;
    start();
    const composing = key("Enter");
    value.capture(composing);
    expect(composing.preventDefault).toHaveBeenCalledOnce();
    (library.props.onClick as () => void)();
    expect(value.onOpenLibrary).not.toHaveBeenCalled();
    end();
    const cooling = key("Escape");
    value.capture(cooling);
    expect(cooling.preventDefault).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(50);
    const released = key("Enter");
    value.capture(released);
    expect(released.preventDefault).not.toHaveBeenCalled();
    (library.props.onClick as () => void)();
    expect(value.onOpenLibrary).toHaveBeenCalledWith("all");
    end();
    expect(vi.getTimerCount()).toBe(1);
    effectCleanups.forEach((cleanup) => cleanup());
    expect(vi.getTimerCount()).toBe(0);
  });
  it("只有原生 IME 标志的 Enter 也进入共用保护", () => {
    vi.useFakeTimers();
    const value = view();
    const event = key("Enter", {
      nativeEvent: { isComposing: true, keyCode: 229 },
    });
    value.capture(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(value.onOpenLibrary).not.toHaveBeenCalled();
    vi.clearAllTimers();
  });
});
