import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createCollapsedTabCellSelection,
  getFirstTabCellReference,
  LXMScoreCommandEnum as C,
} from "@liuxianmao/lxm-editor";
import { buildEditorToolCommand } from "../components/EditorShell/editor-tool-actions";
import { createEditorSession } from "../stores/editor-store";
import { findEditorTools } from "../components/EditorShell/editor-tool-catalog";
import {
  TECHNIQUE_OPTIONS,
  TECHNIQUE_GROUPS,
} from "../components/EditorShell/technique-catalog";
import { createTechniqueTypeController } from "../components/EditorShell/technique-type-controller";

/** 验证入口翻译实际影响的谱层、目标和历史边界，不复制核心音乐算法。 */
describe("工具动作与目录", () => {
  it("多拍拒绝时值，反向跨小节直接复制仍按时间顺序插入末尾", () => {
    const d = EXAMPLE_MVP_7_2_DOCUMENT,
      first = getFirstTabCellReference(d)!,
      second = d.score.tracks[0]!.measures[1]!;
    const selection = {
      anchor: { ...first, measureId: second.id, beatId: second.beats[0]!.id },
      focus: first,
    };
    expect(
      buildEditorToolCommand(d, selection, { type: "rhythm", base: "half" }),
    ).toBeNull();
    expect(
      buildEditorToolCommand(d, selection, { type: "copyMeasures" }),
    ).toMatchObject({
      type: C.CopyMeasureRange,
      sourceStartMeasureId: first.measureId,
      sourceEndMeasureId: second.id,
      afterMeasureId: second.id,
    });
  });
  it("删除只作用所选弦，休止作用整拍，均为一条可撤销命令", () => {
    for (const type of ["removeNotes", "rest"] as const) {
      const s = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT),
        d = s.getState().document!,
        first = getFirstTabCellReference(d)!;
      const selection = createCollapsedTabCellSelection(first);
      const command = buildEditorToolCommand(d, selection, { type })!;
      expect(command.type).toBe(
        type === "rest" ? C.SetBeatKindRange : C.RemoveNotesInRect,
      );
      const result = s.getState().execute(command);
      expect(result?.ok).toBe(true);
      if (!result?.ok) continue;
      const beat = result.document.score.tracks[0]!.measures[0]!.beats[0]!;
      expect(beat.notes.some((note) => note.string === first.string)).toBe(
        false,
      );
      if (type === "rest") expect(beat.notes).toHaveLength(0);
      expect(s.getState().historyDepth.past).toBe(result.changed ? 1 : 0);
      if (result.changed) {
        s.getState().undo();
        expect(s.getState().document).toBe(d);
      }
    }
  });
  it("局部字段可以使用明确小节目标，不借用残留 TAB focus；拍号保持 untilNextChange", () => {
    const d = EXAMPLE_MVP_7_2_DOCUMENT,
      first = getFirstTabCellReference(d)!,
      second = d.score.tracks[0]!.measures[1]!;
    const target = { trackId: first.trackId, measureId: second.id };
    expect(
      buildEditorToolCommand(d, createCollapsedTabCellSelection(first), {
        type: "barline",
        target,
        value: "double",
      }),
    ).toMatchObject({
      type: C.SetBarlineBoundary,
      boundary: { kind: "afterMeasure", measureId: second.id },
    });
    expect(
      buildEditorToolCommand(d, null, {
        type: "signature",
        target,
        value: "3/4",
      }),
    ).toMatchObject({
      type: C.SetTimeSignature,
      measureId: second.id,
      scope: "untilNextChange",
    });
    expect(
      buildEditorToolCommand(d, null, {
        type: "signature",
        target,
        value: "11/16",
      }),
    ).toBeNull();
    expect(
      buildEditorToolCommand(d, null, { type: "startRepeat", target }),
    ).toBeNull();
  });
  it("无效小节引用不回落为首小节，谱首反复使用独立边界", () => {
    const d = EXAMPLE_MVP_7_2_DOCUMENT,
      first = getFirstTabCellReference(d)!;
    expect(
      buildEditorToolCommand(d, null, {
        type: "barline",
        value: "final",
        target: { trackId: first.trackId, measureId: "missing" },
      }),
    ).toBeNull();
    expect(
      buildEditorToolCommand(d, createCollapsedTabCellSelection(first), {
        type: "startRepeat",
      }),
    ).toMatchObject({ boundary: { kind: "trackStart" } });
  });
  it("搜索只返回目录元数据，覆盖中文别名/空结果；16类分组不丢失", () => {
    expect(findEditorTools("覆盖").map((item) => item.group)).toContain("beat");
    expect(findEditorTools("推弦").map((item) => item.group)).toEqual([
      "technique",
    ]);
    expect(findEditorTools("不存在的工具")).toEqual([]);
    expect(findEditorTools(" ")).toHaveLength(6);
    expect(TECHNIQUE_GROUPS.map((group) => group.items.length)).toEqual([
      5, 6, 5,
    ]);
    expect(new Set(TECHNIQUE_OPTIONS.map((item) => item.value)).size).toBe(16);
  });
  it("类型选择仅暂存，必要目标不满足仍保留目录且拒绝选择", () => {
    const picker = createTechniqueTypeController("bend", (type) =>
      type === "arpeggio" ? "需要多弦" : null,
    );
    picker.select("trill");
    expect(picker.getSnapshot()).toBe("trill");
    picker.select("arpeggio");
    expect(picker.getSnapshot()).toBe("trill");
    expect(picker.reason("arpeggio")).toBe("需要多弦");
  });
});
