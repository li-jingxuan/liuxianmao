import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LXM_TUPLET_RATIOS, type ILXMTabCellSelection } from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_5_1_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { TupletToolDetails } from "../../../packages/lxm-editor-react/src/EditorShell/tools/TupletToolDetails";
import { formatTupletExplanation, formatTupletLabel } from "../../../packages/lxm-editor-react/src/EditorShell/shared/tuplet-label";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_5_1_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[3]!;
  const group = measure.tuplets[0]!;
  const selection: ILXMTabCellSelection = {
    anchor: { trackId: track.id, measureId: measure.id, beatId: group.beatIds[0]!, string: 1 },
    focus: { trackId: track.id, measureId: measure.id, beatId: group.beatIds.at(-1)!, string: 6 },
  };
  const execute = vi.fn(async () => ({ status: "cancelled" as const, message: "已取消" }));
  const render = (selected: ILXMTabCellSelection | null = selection) => renderToStaticMarkup(
    <TupletToolDetails document={document} selection={selected} blocked={false} execute={execute} />,
  );
  return { document, track, measure, group, selection, execute, render };
};

describe("连音详情的名称与轻量可用性", () => {
  it("六种真实比例共用中文名称与解释", () => {
    expect(LXM_TUPLET_RATIOS.map(formatTupletLabel)).toEqual([
      "二连音", "三连音", "四连音", "5:4连音", "5:3连音", "六连音",
    ]);
    expect(formatTupletExplanation({ actual: 5, normal: 3 })).toBe("5 个等时值音符，占原本 3 个音符的时间");
  });

  it("按拍点去重跨弦成员；仅高亮文档当前组，没有待应用状态或额外焦点包装", () => {
    const { render, execute } = fixture();
    const html = render();
    expect(html.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g)).toHaveLength(6);
    expect(html).toMatch(/<button[^>]*aria-label="5:4连音"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/<button[^>]*aria-label="5:3连音"[^>]*aria-pressed="false"(?![^>]*disabled)/);
    expect(html).toContain("5 个成员");
    expect(html).not.toContain('role="status"');
    expect(html).toContain('role="group" aria-label="连音类型"');
    expect(html).not.toContain("待应用");
    expect(html).not.toContain("应用所选连音");
    expect(html).not.toContain('tabindex="0"');
    expect(html).not.toMatch(/<button[^>]*(?:title|aria-describedby)=/);
    expect(html).not.toContain("ant-tooltip");
    expect(execute).not.toHaveBeenCalled();
  });

  it("空范围统一提示，每种不符的成员数量给出具体原因", () => {
    const { render } = fixture();
    const empty = render(null);
    expect(empty).toContain("请选择同小节内的连续拍点");
    expect(empty.match(/<button[^>]*aria-pressed="false"[^>]*disabled/g)).toHaveLength(6);
    expect(render()).toContain('aria-description="需要 3 个连续拍点，当前选中 5 个"');
  });

  it.each(["base", "dots"] as const)("书写节奏 %s 不同会禁用类型，容量和 tick 不在展示层预判", (field) => {
    const { measure, group, render } = fixture();
    const member = measure.beats.find((beat) => beat.id === group.beatIds[1])!;
    member.rhythm = field === "base" ? { base: "quarter", dots: 0 } : { ...member.rhythm, dots: 1 };
    expect(render()).toContain("请选择书写时值和附点相同的拍点");
    expect(render()).toMatch(/<button[^>]*aria-label="5:3连音"[^>]*disabled/);
  });

  it("选区覆盖完整旧组时可直接替换，部分覆盖时提示扩大选区", () => {
    const { selection, group, render } = fixture();
    const partial = { ...selection, focus: { ...selection.focus, beatId: group.beatIds[2]! } };
    expect(render(partial)).toContain("请扩大选区以覆盖完整的原连音组");
    expect(render(partial)).toMatch(/<button[^>]*aria-label="三连音"[^>]*disabled/);
    group.beatIds = group.beatIds.slice(0, 2);
    group.ratio = { actual: 2, normal: 3 };
    expect(render(partial)).toMatch(/<button[^>]*aria-label="三连音"(?![^>]*disabled)/);
  });
});
