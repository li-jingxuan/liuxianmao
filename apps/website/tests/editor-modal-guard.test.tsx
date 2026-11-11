import type { HTMLAttributes, KeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorModalGuard } from "../components/EditorShell/session/EditorModalGuard";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));

const setup = (options: { dismissable?: boolean; busy?: boolean } = {}) => {
  const onDismiss = vi.fn();
  const guard = EditorModalGuard({
    dismissable: true,
    ...options,
    onDismiss,
    children: null,
  });
  const props = guard.props as HTMLAttributes<HTMLDivElement>;
  const querySelector = vi.fn(() => null as Element | null);
  const escape = (
    native: { isComposing?: boolean; keyCode?: number } = {},
    defaultPrevented = false,
  ) => {
    const event = {
      key: "Escape",
      keyCode: native.keyCode ?? 27,
      nativeEvent: { isComposing: false, keyCode: 27, ...native },
      currentTarget: { querySelector },
      defaultPrevented,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    };
    props.onKeyDown!(event as unknown as KeyboardEvent<HTMLDivElement>);
    return event;
  };
  return { props, onDismiss, querySelector, escape };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("弹层 Escape 输入边界", () => {
  it("组合输入及结束后的选词 Escape 保留输入，保护结束后才允许关闭", () => {
    const { props, onDismiss, escape } = setup();
    props.onCompositionStart!({} as never);
    const composing = escape();
    expect(composing.stopPropagation).toHaveBeenCalledOnce();
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    props.onCompositionEnd!({} as never);
    escape();
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    const ordinary = escape();
    expect(ordinary.preventDefault).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "仅原生 IME 标志也保护当前及紧接着的 Escape：%j",
    (native) => {
      const { onDismiss, escape } = setup();
      escape(native);
      escape();
      expect(onDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      escape();
      expect(onDismiss).toHaveBeenCalledOnce();
    },
  );

  it("内层展开的下拉框先消费 Escape，收起后再次按键才关闭宿主", () => {
    const { querySelector, onDismiss, escape } = setup();
    querySelector.mockReturnValue({} as Element);
    const event = escape();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    querySelector.mockReturnValue(null);
    escape();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("可见 portal 下拉框阻止宿主关闭，隐藏和无布局的残留节点不阻止", () => {
    const { onDismiss, escape } = setup();
    let visible = true;
    let hidden = false;
    vi.mocked(document.querySelectorAll).mockReturnValue([
      {
        getClientRects: () => (visible ? [{}] : []),
        classList: { contains: () => hidden },
      },
    ] as unknown as NodeListOf<Element>);
    escape();
    expect(onDismiss).not.toHaveBeenCalled();
    hidden = true;
    escape();
    expect(onDismiss).toHaveBeenCalledOnce();
    hidden = false;
    visible = false;
    escape();
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it.each([
    { busy: true, dismissable: true },
    { busy: false, dismissable: false },
  ])("忙碌或不可快捷关闭的宿主不响应 Escape：%j", (options) => {
    const { onDismiss, escape } = setup(options);
    const event = escape();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("内层已处理的 Escape 不触发宿主关闭", () => {
    const { onDismiss, escape } = setup();
    escape({}, true);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
