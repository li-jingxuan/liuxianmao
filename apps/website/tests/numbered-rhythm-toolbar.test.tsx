import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NumberedRhythmToolbar } from "../components/EditorShell/numbered/NumberedRhythmToolbar";

const find = (tree: ReactNode, label: string): Record<string, unknown> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return null;
  return tree.props.label === label ? tree.props : find(tree.props.children as ReactNode, label);
};

describe("简谱时值符号栏", () => {
  it("呈现六个时值、一个音乐附点和一个直横线，无额外可见标签", () => {
    const tree = NumberedRhythmToolbar({ base: "eighth", dots: 1, onChange: vi.fn(), onSustain: vi.fn() });
    const markup = renderToStaticMarkup(tree);
    expect((markup.match(/<button\b/g) ?? []).length).toBe(8);
    expect(markup).toContain("\uE1E7");
    expect(markup).toContain("\uE874");
    expect(markup).not.toContain(">时值<");
    expect(markup).not.toContain("title=");
    for (const label of ["全音符", "二分音符", "四分音符", "八分音符", "十六分音符", "三十二分音符", "单附点", "延音"]) {
      expect(find(tree, label)?.availability).toMatchObject({ enabled: true });
    }
    expect(find(tree, "八分音符")?.pressed).toBe(true);
    expect(find(tree, "单附点")?.pressed).toBe(true);
  });

  it.each([0, 1, 2])("时值修改保留 %i 附点，单附点可切换", (dots) => {
    const onChange = vi.fn();
    const tree = NumberedRhythmToolbar({ base: "eighth", dots, onChange });
    (find(tree, "十六分音符")!.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith("sixteenth", dots);
    (find(tree, "单附点")!.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith("eighth", dots === 1 ? 0 : 1);
  });

  it("第八个入口回调延音，反映选中态并兼容未提供回调的调用方", () => {
    const onChange = vi.fn();
    const onSustain = vi.fn();
    const tree = NumberedRhythmToolbar({ base: "quarter", dots: 0, onChange, onSustain, sustain: true });
    expect(find(tree, "延音")?.pressed).toBe(true);
    (find(tree, "延音")!.onClick as () => void)();
    expect(onSustain).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    const legacy = NumberedRhythmToolbar({ base: "quarter", dots: 0, onChange });
    expect(find(legacy, "延音")?.availability).toMatchObject({ enabled: false, reason: expect.any(String) });
  });

  it("禁用按钮通过可聚焦外层提供原因，禁用时不调用编辑回调", () => {
    const onChange = vi.fn();
    const onSustain = vi.fn();
    const tree = NumberedRhythmToolbar({ base: "quarter", dots: 0, disabled: true, disabledReason: "请先应用简谱内容", onChange, onSustain });
    for (const label of ["八分音符", "单附点", "延音"]) {
      expect(find(tree, label)?.availability).toEqual({ enabled: false, reason: "请先应用简谱内容" });
      (find(tree, label)!.onClick as () => void)();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(onSustain).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(tree);
    expect((markup.match(/tabindex="0"/g) ?? []).length).toBe(8);
    expect((markup.match(/disabled=""/g) ?? []).length).toBe(8);
  });
});
