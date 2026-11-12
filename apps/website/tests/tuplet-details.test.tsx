import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_5_1_DOCUMENT, LXM_TUPLET_RATIOS, type ILXMTabCellSelection } from "@liuxianmao/lxm-editor";
import { TupletToolDetails } from "../components/EditorShell/tools/TupletToolDetails";
import { formatTupletExplanation, formatTupletLabel } from "../components/EditorShell/shared/tuplet-label";

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
      "二连音", "三连音", "四连音", "五连音（5:4）", "五连音（5:3）", "六连音",
    ]);
    expect(formatTupletExplanation({ actual: 5, normal: 3 })).toBe("5 个等时值音符，占原本 3 个音符的时间");
  });

  it("按拍点去重跨弦成员；当前组高亮但不产生待应用草稿", () => {
    const { render, execute } = fixture();
    const html = render();
    expect(html.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g)).toHaveLength(6);
    expect(html).toMatch(/<button[^>]*aria-label="五连音（5:4）"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/<button[^>]*aria-label="五连音（5:3）"[^>]*aria-pressed="false"(?![^>]*disabled)/);
    expect(html).toContain("5 个成员");
    expect(html).not.toContain('role="status"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>应用所选连音<\/span>/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("空范围统一提示，每种不符的成员数量给出具体原因", () => {
    const { render } = fixture();
    const empty = render(null);
    expect(empty).toContain("请选择同小节内的连续拍点");
    expect(empty.match(/<button[^>]*aria-pressed="false"[^>]*disabled/g)).toHaveLength(6);
    expect(render()).toContain("需要 3 个连续拍点，当前选中 5 个");
  });

  it.each(["base", "dots"] as const)("书写节奏 %s 不同会禁用待选，容量和 tick 不在展示层预判", (field) => {
    const { measure, group, render } = fixture();
    const member = measure.beats.find((beat) => beat.id === group.beatIds[1])!;
    member.rhythm = field === "base" ? { base: "quarter", dots: 0 } : { ...member.rhythm, dots: 1 };
    expect(render()).toContain("请选择书写时值和附点相同的拍点");
    expect(render()).toMatch(/<button[^>]*aria-label="五连音（5:3）"[^>]*disabled/);
  });

  it("部分选中已有组时提示先删除，而完整组允许切换比例", () => {
    const { selection, group, render } = fixture();
    const partial = { ...selection, focus: { ...selection.focus, beatId: group.beatIds[2]! } };
    expect(render(partial)).toContain("连音组不能部分重叠或嵌套，请先删除原组");
    expect(render(partial)).toMatch(/<button[^>]*aria-label="三连音"[^>]*disabled/);
    expect(render()).not.toContain("连音组不能部分重叠或嵌套");
  });
});
