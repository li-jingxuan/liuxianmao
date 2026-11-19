import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_5_1_DOCUMENT, LXMScoreCommandEnum } from "@liuxianmao/lxm-editor";
import { TupletToolbar } from "../components/EditorShell/tools/TupletToolbar";
import { MeasureBoundary } from "../components/EditorShell/tools/MeasureBoundary";
import { MeasureActions } from "../components/EditorShell/tools/MeasureActions";
import { buildEditorToolCommand } from "../components/EditorShell/tools/editor-tool-actions";
import { previewMeasureRemoval } from "../components/EditorShell/tools/measure-removal-preview";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_5_1_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[3]!;
  const group = measure.tuplets[0]!;
  const selection = { anchor: { trackId: track.id, measureId: measure.id, beatId: group.beatIds[0]!, string: 1 },
    focus: { trackId: track.id, measureId: measure.id, beatId: group.beatIds.at(-1)!, string: 6 } };
  const execute = vi.fn(async () => ({ status: "cancelled" as const, message: "取消" }));
  return { document, track, measure, selection, execute };
};

describe("紧凑连音及小节即时控件", () => {
  it("两种五连音按五个实际拍点启用，图标区分比例并保留可访问名", () => {
    const { document, selection, execute } = fixture();
    const html = renderToStaticMarkup(<TupletToolbar document={document} selection={selection} execute={execute} />);
    expect(html).toMatch(/<button[^>]*aria-label="5:4连音（5:4）"[^>]*aria-pressed="true"(?![^>]*disabled)/);
    expect(html).toMatch(/<button[^>]*aria-label="5:3连音（5:3）"[^>]*aria-pressed="false"(?![^>]*disabled)/);
    expect(html).toContain(">5:4</text>"); expect(html).toContain(">5:3</text>");
    expect(html).toContain("同小节内，连续拍点数须与连音数字一致。");
    expect(html).not.toContain("连音比例与选区详情");
  });
  it("侧栏无TAB目标时不借用旧选区，禁用原因可聚焦读取", () => {
    const { document, execute } = fixture();
    const html = renderToStaticMarkup(<TupletToolbar document={document} selection={null} execute={execute} presentation="sidebar" />);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(6);
    expect(html).toContain('tabindex="0"'); expect(html).toContain("请先选择 TAB 目标。");
    expect(html).not.toContain("删除连音组");
  });
  it("谱尾仅禁止开始及双向反复，谱首反复独立禁用", () => {
    const { document, track } = fixture();
    const html = renderToStaticMarkup(<MeasureBoundary document={document} target={{ trackId: track.id, measureId: track.measures.at(-1)!.id }} blocked={false} onAction={vi.fn()} />);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3);
    expect(html).toMatch(/<button[^>]*aria-label="开始反复线"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*aria-label="双向反复线"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*aria-label="谱首反复"[^>]*disabled/);
  });
  it("跨小节范围中显式复制只复制焦点当前小节", () => {
    const { document, track, selection } = fixture();
    const first = track.measures[0]!;
    const range = { ...selection, anchor: { ...selection.anchor, measureId: first.id, beatId: first.beats[0]!.id } };
    expect(buildEditorToolCommand(document, range, { type: "copyMeasures", target: { trackId: track.id, measureId: selection.focus.measureId } })).toMatchObject({
      type: LXMScoreCommandEnum.CopyMeasureRange, sourceStartMeasureId: selection.focus.measureId,
      sourceEndMeasureId: selection.focus.measureId, afterMeasureId: selection.focus.measureId,
    });
  });
  it("删除预检不写原谱，并提供技巧及简谱关系影响", () => {
    const { document, track, measure } = fixture();
    const original = structuredClone(document);
    const preview = previewMeasureRemoval(document, { trackId: track.id, measureId: measure.id });
    expect(preview.ok).toBe(true); expect(preview.message).toContain("简谱连接记号"); expect(preview.message).toContain("跨小节关系");
    expect(document).toEqual(original);
  });
  it("至少保留一个小节，新增复制仍可浏览", () => {
    const { document, track } = fixture(); track.measures = track.measures.slice(0, 1);
    const html = renderToStaticMarkup(<MeasureActions document={document} target={{ trackId: track.id, measureId: track.measures[0]!.id }} blocked={false} onAction={vi.fn()} />);
    expect(html).toMatch(/<button[^>]*aria-label="删除当前小节"[^>]*disabled/);
    expect(html).toContain("须至少保留一个小节。");
  });
});
