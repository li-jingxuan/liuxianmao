import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NumberedPitchFields } from "../../../packages/lxm-editor-react/src/EditorShell/numbered/NumberedPitchFields";

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

describe("简谱音高分项字段", () => {
  it("读取不产生修改，八度修改保留现有变音编码与音级", () => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "♯5'''", onChange });
    expect(onChange).not.toHaveBeenCalled();
    expect(find(tree, "高3八度")?.pressed).toBe(true);
    expect(find(tree, "升号")?.pressed).toBe(true);
    (find(tree, "低八度")!.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith("♯5.");
  });

  it("八度选项仅支持低两八度至高三八度", () => {
    const tree = NumberedPitchFields({ value: "1", onChange: vi.fn() });
    const markup = renderToStaticMarkup(tree);
    expect((markup.match(/<button\b/g) ?? []).length).toBe(10);
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain('aria-label="简谱单音符音高"');
    for (const label of ["低2八度", "低八度", "本位", "高八度", "高2八度", "高3八度"]) {
      expect(find(tree, label)).not.toBeNull();
    }
  });

  it.each([
    [-2, "低2八度"], [-1, "低八度"], [0, "本位"],
    [1, "高八度"], [2, "高2八度"], [3, "高3八度"],
  ] as const)("八度 %i 使用绝对值，并保留还原号和音级", (octave, label) => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "n4..", onChange });
    (find(tree, label)!.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith(`n4${octave > 0 ? "'".repeat(octave) : ".".repeat(-octave)}`);
  });

  it.each([["", "无变音"], ["n", "还原号"], ["#", "升号"], ["b", "降号"]])("变音可明确设为 %j，不改变音级和八度", (accidental, label) => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "b6..", onChange });
    (find(tree, label!)!.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith(`${accidental}6..`);
  });

  it("非法音高不被分项控件静默改写，休止不提供音高编辑", () => {
    for (const value of ["0", "-", "#9", "1+3", "1...", "1''''"]) {
      const onChange = vi.fn();
      const tree = NumberedPitchFields({ value, onChange });
      for (const label of ["本位", "低2八度", "升号", "无变音"]) {
        expect(find(tree, label)?.availability).toMatchObject({ enabled: false });
        (find(tree, label)!.onClick as () => void)();
      }
      expect(onChange).not.toHaveBeenCalled();
    }
  });

  it("外部禁用原因为工具提示提供说明，禁用期间不修改 token", () => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "b6..", disabled: true, disabledReason: "请先应用简谱内容", onChange });
    for (const label of ["本位", "低2八度", "升号", "无变音"]) {
      expect(find(tree, label)?.availability).toEqual({ enabled: false, reason: "请先应用简谱内容" });
      (find(tree, label)!.onClick as () => void)();
    }
    expect(onChange).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(tree);
    expect((markup.match(/tabindex="0"/g) ?? []).length).toBe(10);
    expect((markup.match(/disabled=""/g) ?? []).length).toBe(10);
  });

  it("分项字段具有可访问名称", () => {
    const markup = renderToStaticMarkup(<NumberedPitchFields value="1" onChange={() => {}} />);
    expect(markup).toContain('aria-label="简谱单音符八度"');
    expect(markup).toContain('aria-label="简谱单音符变音"');
    expect(markup).toContain('aria-label="本位" aria-pressed="true"');
    expect(markup).toContain('aria-label="无变音" aria-pressed="true"');
  });
});
