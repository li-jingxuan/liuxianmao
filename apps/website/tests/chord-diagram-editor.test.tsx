import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyChordPreset, layoutChordDiagram } from "@liuxianmao/lxm-editor";
import { ChordDiagramEditorModal, replaceChordDiagramEditorSnapshot, type ChordDiagramEditorSnapshot } from "../components/EditorShell/chords/ChordDiagramEditorModal";

describe("自定义指法宿主正文", () => {
  it("紧凑网格、统一手指选择器和右侧有效预览，删除精细表单", () => {
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord: copyChordPreset("C")! }} tuning={[]} onComplete={() => {}} onCancel={() => {}} onSave={() => ({ ok: true })} />);
    expect(html.match(/role="gridcell"/g)).toHaveLength(36);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="按弦手指"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain("未指定");
    expect(html).toContain("最后有效指法预览");
    expect(html).toContain("另存为我的指法");
    expect(html).not.toMatch(/谱面缩小示意|精细编辑|横按设置|当前按弦|新按点的手指|横按工具手指/);
    expect(html).not.toContain('role="dialog"');
  });
  it("无图起步时允许点完成触发发声校验", () => {
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord: { name: "C", diagram: null } }} tuning={[]} onComplete={() => {}} onCancel={() => {}} />);
    expect(html).toContain("尚无有效指法预览");
    expect(html).not.toContain("至少一根弦应可发声");
    expect(html).not.toContain("和弦名称应为非空单行");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toMatch(/disabled=""[^>]*>完成编辑/);
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

  it("暂存恢复原始非法输入、有效预览与撤销重做状态；库替换可撤销且不重置 dirty 基准", () => {
    const chord = copyChordPreset("C")!;
    const baseline = { name: chord.name, startFret: "1", strings: chord.diagram!.strings.map((string) => ({ string: string.string, fret: String(string.fret), finger: string.finger === null ? "" : String(string.finger) })), barres: chord.diagram!.barres };
    const invalid = { ...baseline, name: "未完成", startFret: "abc" };
    const snapshot: ChordDiagramEditorSnapshot = { baseline, history: { past: [baseline], present: invalid, future: [{ ...invalid, name: "重做内容" }] }, lastValid: chord.diagram!, tool: "barre", selection: { type: "point", string: 2 }, nextFinger: "T", endpoint: { string: 6, fret: 1 }, actionIssues: [], latestField: "name", notice: "已存入我的指法", activeCell: 13 };
    const render = (value: ChordDiagramEditorSnapshot) => renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord }} initialSnapshot={value} tuning={[]} onComplete={() => {}} onCancel={() => {}} onOpenLibrary={() => {}} />);
    const html = render(snapshot);
    expect(html).toContain('value="abc"');
    expect(html).toContain('value="未完成"');
    expect(html).toContain("保留上次有效指法");
    expect(html).toContain("查看我的指法");
    expect(html).toContain("已存入我的指法");
    expect(html).toContain('aria-pressed="true">横按');
    const replacement = replaceChordDiagramEditorSnapshot(snapshot, { display: "name", chord: copyChordPreset("F")! });
    expect(replacement.baseline).toBe(baseline);
    expect(replacement.history.past.at(-1)).toBe(invalid);
    expect(replacement.history.present.name).toBe("F");
    expect(replacement.history.future).toEqual([]);
    expect(replacement.endpoint).toBeNull();
    expect(replacement.tool).toBe("barre");
    expect(replacement.nextFinger).toBe("T");
    expect(replacement.activeCell).toBe(13);
    expect(snapshot.history.present.startFret).toBe("abc");
    expect(snapshot.history.future).toHaveLength(1);
    expect(render(replacement)).toContain('value="F"');
  });
});
