import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Dropdown, Input } from "antd";
import { ChordPresetControls } from "../components/EditorShell/chords/ChordPresetControls";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  refs: [] as { current: unknown }[],
  refsIndex: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
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
function view() {
  harness.effects = [];
  harness.refs = [];
  harness.refsIndex = 0;
  const onOpenLibrary = vi.fn(),
    onOpenSettings = vi.fn();
  const tree = ChordPresetControls({
    draft: { display: "name", chord: { name: "Bm", diagram: null } },
    onChange: vi.fn(),
    presetsEnabled: true,
    menuOpen: true,
    onOpenLibrary,
    onOpenSettings,
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
    const value = view();
    const effectCleanups = harness.effects
      .map((effect) => effect())
      .filter(
        (cleanup): cleanup is () => void => typeof cleanup === "function",
      );
    const start = value.popup.props.onCompositionStart as () => void,
      end = value.popup.props.onCompositionEnd as () => void;
    const library = value.nodes.find(
      (node) => node.props.children === "完整和弦库",
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
    expect(value.onOpenLibrary).toHaveBeenCalledWith("key");
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
