import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyChordPreset, layoutChordDiagram } from "@liuxianmao/lxm-editor";
import { ChordDiagramEditorModal } from "../components/EditorShell/chords/ChordDiagramEditorModal";

describe("自定义指法宿主正文", () => {
  it("紧凑网格、统一手指选择器和右侧有效预览，删除精细表单", () => {
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord: copyChordPreset("C")! }} tuning={[]} onComplete={() => {}} onCancel={() => {}} onSave={() => ({ ok: true })} />);
    expect(html.match(/role="gridcell"/g)).toHaveLength(36);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="按弦手指"');
    expect(html).toContain('value="T"');
    expect(html).toContain('value="" selected=""');
    expect(html).toContain("最后有效指法预览");
    expect(html).toContain("另存为我的指法");
    expect(html).not.toMatch(/谱面缩小示意|精细编辑|横按设置|当前按弦|新按点的手指|横按工具手指/);
    expect(html).not.toContain('role="dialog"');
  });
  it("无图起步只显示一条最新结构错误并禁止提交全禁奏图", () => {
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord: { name: "", diagram: null } }} tuning={[]} onComplete={() => {}} onCancel={() => {}} />);
    expect(html).toContain("尚无有效指法预览");
    expect(html).toContain("至少一根弦应可发声");
    expect(html).not.toContain("和弦名称应为非空单行");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/disabled=""[^>]*>完成编辑/);
  });
  it("非法 seed 不交给布局，最后有效预览保持空态", () => {
    const chord = copyChordPreset("C")!;
    chord.diagram!.strings[0]!.fret = Number.NaN;
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "nameAndDiagram", chord }} tuning={[]} onComplete={() => {}} onCancel={() => {}} />);
    expect(html).toContain("第 1 弦：品位应为 x、0 或 1–24 的整数");
    expect(html).toContain("尚无有效指法预览");
    expect(html).not.toContain('aria-label="指法图预览"');
  });
  it("布局显示拇指，未指定横按不输出 null 标签", () => {
    const diagram = copyChordPreset("F")!.diagram;
    diagram.barres[0]!.finger = null;
    const plain = layoutChordDiagram(diagram);
    expect(plain.texts.some((t) => t.text === "null")).toBe(false);
    diagram.barres[0]!.finger = "T";
    expect(layoutChordDiagram(diagram).texts.some((t) => t.text === "T")).toBe(true);
  });
});
