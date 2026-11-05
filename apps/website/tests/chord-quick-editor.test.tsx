import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { copyChordPreset } from "@liuxianmao/lxm-editor";
import {
  ChordQuickEditor,
  type ChordQuickEditorProps,
} from "../components/EditorShell/ChordQuickEditor";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const descendants = (node: ReactNode): Element[] =>
  Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as Element;
    return [element, ...descendants(element.props.children)];
  });
function view(overrides: Partial<ChordQuickEditorProps> = {}) {
  const props: ChordQuickEditorProps = {
    draft: { display: "nameAndDiagram", chord: copyChordPreset("C")! },
    onChange: vi.fn(),
    inputRef: vi.fn(),
    presetsEnabled: true,
    disabled: false,
    onFixDiagram: vi.fn(),
    ...overrides,
  };
  const tree = ChordQuickEditor(props);
  const elements = descendants(tree);
  return {
    props,
    elements,
    html: renderToStaticMarkup(tree),
    button: (name: string) =>
      elements.find(
        (element) =>
          element.props.children === name &&
          typeof element.props.onClick === "function",
      )!,
  };
}

describe("和弦快捷表单", () => {
  it("名称仅更新文本，保留指法引用及显示方式", () => {
    const value = view();
    const input = value.elements.find(
      (element) => element.props.id === "chord-popover-name",
    )!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "G7" },
    });
    const next = vi.mocked(value.props.onChange).mock.lastCall![0];
    expect(next.chord.name).toBe("G7");
    expect(next.chord.diagram).toBe(value.props.draft.chord.diagram);
    expect(next.display).toBe(value.props.draft.display);
  });

  it("预设替换名称、指法与显示；高亮同时比较名称和图", () => {
    const value = view();
    (value.button("Am").props.onClick as () => void)();
    expect(value.props.onChange).toHaveBeenCalledWith({
      display: "nameAndDiagram",
      chord: copyChordPreset("Am"),
    });
    expect(value.button("C").props["aria-pressed"]).toBe(true);
    const renamed = view({
      draft: {
        ...value.props.draft,
        chord: { ...value.props.draft.chord, name: "G" },
      },
    });
    expect(renamed.button("G").props["aria-pressed"]).toBe(false);
  });

  it("气泡不提供显示切换；无图提示和仅名称时的指法预览保留", () => {
    const empty = view({
      draft: { display: "name", chord: { name: "C", diagram: null } },
    });
    expect(empty.button("名称与指法")).toBeUndefined();
    expect(empty.button("仅名称")).toBeUndefined();
    expect(empty.html).toContain("尚未设置指法");
    expect(empty.html).not.toContain('aria-label="指法图预览"');
    const named = view({
      draft: { display: "name", chord: copyChordPreset("C")! },
    });
    expect(named.html).toContain("指法保留，不显示在谱面");
    expect(named.html).toContain('aria-label="指法图预览"');
    expect(named.html).not.toContain('aria-label="和弦显示方式"');
    expect(named.props.onChange).not.toHaveBeenCalled();
  });

  it("非法图即使仅名称仍报错并可前往修正", () => {
    const chord = copyChordPreset("C")!;
    chord.diagram!.startFret = Number.NaN;
    const value = view({ draft: { display: "name", chord } });
    expect(value.html).toContain("已暂停预览");
    expect(value.html).not.toContain('aria-label="指法图预览"');
    (value.button("前往修正").props.onClick as () => void)();
    expect(value.props.onFixDiagram).toHaveBeenCalledOnce();
  });

  it("非标准调弦保留图并禁用预设；锁定阻止全部修改且不禁用输入 DOM", () => {
    const tuning = view({ presetsEnabled: false });
    expect(tuning.html).toContain("非标准调弦");
    expect(tuning.html).toContain('aria-label="指法图预览"');
    expect(tuning.button("G").props.disabled).toBe(true);
    (tuning.button("G").props.onClick as () => void)();
    expect(tuning.props.onChange).not.toHaveBeenCalled();
    const locked = view({ disabled: true });
    const input = locked.elements.find(
      (element) => element.props.id === "chord-popover-name",
    )!;
    expect(input.props.readOnly).toBe(true);
    expect(input.props.disabled).toBeUndefined();
    (input.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "G" },
    });
    (locked.button("G").props.onClick as () => void)();
    expect(locked.props.onChange).not.toHaveBeenCalled();
  });
  it("IME 命令锁不阻止组合文字同步", () => {
    const value = view({ disabled: true, inputReadOnly: false });
    const input = value.elements.find((element) => element.props.id === "chord-popover-name")!;
    expect(input.props.readOnly).toBe(false);
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "和弦" } });
    expect(value.props.onChange).toHaveBeenCalledOnce();
    expect(value.button("G").props.disabled).toBe(true);
  });
});
