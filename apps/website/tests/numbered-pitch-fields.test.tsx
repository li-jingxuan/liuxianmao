import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NumberedPitchFields } from "../components/EditorShell/numbered/NumberedPitchFields";

const find = (tree: ReactNode, label: string): Record<string, unknown> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return null;
  return tree.props["aria-label"] === label ? tree.props : find(tree.props.children as ReactNode, label);
};

describe("简谱音高分项字段", () => {
  it("修改音级保留现有变音编码与三层八度，读取不产生修改", () => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "♯5'''", onChange });
    expect(onChange).not.toHaveBeenCalled();
    expect(find(tree, "简谱单音符八度")?.value).toBe(3);
    expect(find(tree, "简谱单音符变音")?.value).toBe("#");
    (find(tree, "简谱单音符音高")!.onChange as (value: string) => void)("2");
    expect(onChange).toHaveBeenCalledWith("♯2'''");
  });

  it("八度选项仅支持低两八度至高三八度", () => {
    const tree = NumberedPitchFields({ value: "1", onChange: vi.fn() });
    expect(find(tree, "简谱单音符八度")?.options).toEqual([
      { value: -2, label: "低2八度" },
      { value: -1, label: "低八度" },
      { value: 0, label: "本位" },
      { value: 1, label: "高八度" },
      { value: 2, label: "高2八度" },
      { value: 3, label: "高3八度" },
    ]);
  });

  it.each([-2, -1, 0, 1, 2, 3])("八度 %i 使用绝对值，并保留还原号和音级", (octave) => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "n4..", onChange });
    (find(tree, "简谱单音符八度")!.onChange as (value: number) => void)(octave);
    expect(onChange).toHaveBeenCalledWith(`n4${octave > 0 ? "'".repeat(octave) : ".".repeat(-octave)}`);
  });

  it.each(["", "#", "b", "n"])("变音可明确设为 %j，不改变音级和八度", (accidental) => {
    const onChange = vi.fn();
    const tree = NumberedPitchFields({ value: "b6..", onChange });
    (find(tree, "简谱单音符变音")!.onChange as (value: string) => void)(accidental);
    expect(onChange).toHaveBeenCalledWith(`${accidental}6..`);
  });

  it("非法音高不被分项控件静默改写，休止不提供音高编辑", () => {
    for (const value of ["0", "-", "#9", "1+3", "1...", "1''''"]) {
      const onChange = vi.fn();
      const tree = NumberedPitchFields({ value, onChange });
      for (const label of ["简谱单音符音高", "简谱单音符八度", "简谱单音符变音"]) {
        expect(find(tree, label)?.disabled).toBe(true);
      }
      expect(onChange).not.toHaveBeenCalled();
    }
  });

  it("分项字段具有可访问名称", () => {
    const markup = renderToStaticMarkup(<NumberedPitchFields value="1" onChange={() => {}} />);
    expect(markup).toContain('aria-label="简谱单音符八度"');
    expect(markup).toContain('aria-label="简谱单音符音高"');
    expect(markup).toContain('aria-label="简谱单音符变音"');
  });
});
