import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyChordPreset } from "@liuxianmao/lxm-editor";
import { ChordDiagramEditorModal } from "../components/EditorShell/chords/ChordDiagramEditorModal";

describe("自定义指法宿主正文", () => {
  it("真实组件输出独立语义网格和表单、最后合法预览及宿主底栏", () => {
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord: copyChordPreset("C")! }} tuning={[]} onComplete={() => {}} onCancel={() => {}} onSave={() => ({ ok: true })} />);
    expect(html.match(/role="gridcell"/g)).toHaveLength(36);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.indexOf('aria-label="6弦品位"')).toBeLessThan(html.indexOf('aria-label="1弦品位"'));
    expect(html).toContain("最后有效指法预览");
    expect(html).toContain("指法已保留，谱面当前仅显示名称");
    expect(html).toContain("另存为我的指法");
    expect(html).toContain('aria-label="新按点的手指"');
    expect(html).toContain("谱面缩小示意");
    expect(html).toContain("精细编辑 · 六弦与手指");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("ant-modal");
    expect(html).not.toContain("续音");
  });
  it("无图起步保留可操作网格和无合法图空态，禁止提交全禁奏图", () => {
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "name", chord: { name: "", diagram: null } }} tuning={[]} onComplete={() => {}} onCancel={() => {}} />);
    expect(html).toContain("尚无有效指法预览");
    expect(html).toContain("至少一根弦应可发声");
    expect(html).toContain("和弦名称应为非空单行");
    expect(html.match(/role="gridcell"/g)).toHaveLength(36);
    expect(html).toMatch(/disabled=""[^>]*>完成编辑/);
  });
  it("非法 seed 的 NaN 不交给图形布局，保留字段错误和全部修复入口", () => {
    const chord = copyChordPreset("C")!;
    chord.diagram!.strings[0]!.fret = Number.NaN;
    const html = renderToStaticMarkup(<ChordDiagramEditorModal seed={{ display: "nameAndDiagram", chord }} tuning={[]} onComplete={() => {}} onCancel={() => {}} />);
    expect(html).toContain("第 1 弦：品位应为 x、0 或 1–24 的整数");
    expect(html).toContain("尚无有效指法预览");
    expect(html).not.toContain('aria-label="指法图预览"');
    expect(html).toContain('aria-label="1弦品位"');
  });
});
