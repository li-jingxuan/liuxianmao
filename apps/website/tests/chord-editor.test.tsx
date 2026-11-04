import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button, Dropdown, type MenuProps } from "antd";
import {
  CHORD_PRESETS,
  copyChordPreset,
  validateChordDiagram,
} from "@liuxianmao/lxm-editor";
import {
  ChordEditor,
  type ChordDraft,
} from "../components/EditorShell/ChordEditor";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function descendants(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as Element;
    return [element, ...descendants(element.props.children)];
  });
}
function view(name = "C", presetsEnabled = true) {
  const draft: ChordDraft = {
    display: "nameAndDiagram",
    chord: copyChordPreset(name)!,
  };
  const onChange = vi.fn<(draft: ChordDraft) => void>();
  const tree = ChordEditor({
    draft,
    onChange,
    presetsEnabled,
    inputRef: () => {},
  });
  const elements = descendants(tree);
  return {
    draft,
    onChange,
    tree,
    elements,
    change(label: string, value: unknown) {
      const control = elements.find(
        (element) => element.props["aria-label"] === label,
      )!;
      (control.props.onChange as (value: unknown) => void)(value);
      return onChange.mock.lastCall![0];
    },
  };
}

describe("和弦草稿编辑布局", () => {
  it("六弦以 6→1 显示，编辑按弦号更新且不改变领域的 1→6 保存顺序", () => {
    const value = view();
    const before = structuredClone(value.draft);
    const labels = value.elements
      .map((element) => element.props["aria-label"])
      .filter((label) => typeof label === "string" && label.endsWith("弦品位"));
    expect(labels).toEqual([
      "6弦品位",
      "5弦品位",
      "4弦品位",
      "3弦品位",
      "2弦品位",
      "1弦品位",
    ]);
    const changed = value.change("6弦品位", 2);
    expect(
      changed.chord.diagram!.strings.map((string) => string.string),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      changed.chord.diagram!.strings.find((string) => string.string === 6)!
        .fret,
    ).toBe(2);
    expect(changed.chord.diagram!.strings.slice(0, 5)).toEqual(
      before.chord.diagram!.strings.slice(0, 5),
    );
    expect(value.draft).toEqual(before);
  });

  it.each([0, "x"])(
    "空弦/禁奏 %s 清除当前弦手指，并给禁用控件说明原因",
    (fret) => {
      const value = view();
      const changed = value.change("5弦品位", fret);
      expect(
        changed.chord.diagram!.strings.find((string) => string.string === 5),
      ).toMatchObject({ fret, finger: null });
      const tree = ChordEditor({
        draft: changed,
        onChange: value.onChange,
        presetsEnabled: true,
        inputRef: () => {},
      });
      const control = descendants(tree).find(
        (element) => element.props["aria-label"] === "5弦手指",
      )!;
      expect(control.props.disabled).toBe(true);
      expect(control.props["aria-describedby"]).toBe("chord-finger-reason-5");
      expect(renderToStaticMarkup(tree)).toContain(
        fret === 0 ? "空弦无需手指" : "禁奏弦无需手指",
      );
    },
  );

  it("原型六个快捷指法与其他预设都复制完整音乐参数，只更新草稿", () => {
    const value = view();
    const quick = value.elements.filter(
      (element) =>
        element.type === Button &&
        typeof element.props.children === "string" &&
        ["C", "G", "Am", "F", "Dm", "Em"].includes(element.props.children),
    );
    expect(quick.map((element) => element.props.children)).toEqual([
      "C",
      "G",
      "Am",
      "F",
      "Dm",
      "Em",
    ]);
    const dropdown = value.elements.find(
      (element) => element.type === Dropdown,
    )!;
    const menu = dropdown.props.menu as MenuProps;
    const names = [
      ...quick.map((element) => element.props.children as string),
      ...menu.items!.map((item) => String(item!.key)),
    ];
    expect([...names].sort()).toEqual(
      CHORD_PRESETS.map((preset) => preset.name).sort(),
    );
    for (const preset of CHORD_PRESETS) {
      const button = quick.find(
        (element) => element.props.children === preset.name,
      );
      if (button) (button.props.onClick as () => void)();
      else
        menu.onClick!({ key: preset.name } as Parameters<
          NonNullable<MenuProps["onClick"]>
        >[0]);
      const changed = value.onChange.mock.lastCall![0];
      expect(changed).toEqual({ display: "nameAndDiagram", chord: preset });
      expect(changed.chord.diagram).not.toBe(preset.diagram);
      expect(validateChordDiagram(changed.chord.diagram!)).toBeNull();
    }
  });

  it("非标准调弦暂停所有预设，保留自定义六弦、横按与观察窗口", () => {
    const value = view("F", false);
    expect(
      value.elements
        .filter(
          (element) =>
            element.type === Button && "aria-pressed" in element.props,
        )
        .every((element) => element.props.disabled),
    ).toBe(true);
    const markup = renderToStaticMarkup(value.tree);
    expect(markup).toContain("常用预设暂停，仍可自定义六弦与横按");
    expect(markup).toContain("6弦品位");
    expect(markup).toContain("横按1fret");
    expect(markup).toContain("起始品位");
    expect(validateChordDiagram(value.draft.chord.diagram!)).toBeNull();
  });

  it("观察窗口清空保留非法草稿并撤去预览，不改实际品位", () => {
    const value = view();
    const changed = value.change("起始品位", null);
    expect(changed.chord.diagram!.startFret).toBeNaN();
    expect(changed.chord.diagram!.strings).toEqual(
      value.draft.chord.diagram!.strings,
    );
    const markup = renderToStaticMarkup(
      <ChordEditor
        draft={changed}
        onChange={value.onChange}
        presetsEnabled
        inputRef={() => {}}
      />,
    );
    expect(markup).toContain("起始品位应为 1–20");
    expect(markup).not.toContain('aria-label="指法图预览"');
  });
});
