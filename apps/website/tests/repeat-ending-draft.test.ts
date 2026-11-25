import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLayout, getMissingRepeatEndingPasses, loadDocument } from "@liuxianmao/lxm-editor";
import { createRepeatEndingDraftModel, findRepeatEndingDraftIssue } from "../../../packages/lxm-editor-react/src/EditorShell/tools/repeat-ending-draft";

const fixture = readFileSync(new URL("../../../packages/lxm-editor/tests/fixtures/req106-three-endings.lxm", import.meta.url), "utf8");
function openFixture() {
  const result = loadDocument(fixture);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  const track = result.document.score.tracks[0]!;
  return { document: result.document, track, group: track.repeatEndingGroups![0]! };
}

describe("反复房子整组表单", () => {
  it("只标记能独立移出冲突的结尾区末字段", () => {
    const { track } = openFixture();
    const measures = Array.from({ length: 36 }, (_, index) => ({ ...track.measures[0]!, id: `m${index + 1}` }));
    const first = { ...track.repeatEndingGroups![0]!, startMeasureId: "m17", sharedEndMeasureId: "m31", endMeasureId: "m35", endings: [] };
    const expanded = { ...track, measures, repeatEndingGroups: [first] };
    const model = createRepeatEndingDraftModel(expanded);
    const draft = { ...model.create(["m4"], "")!, endMeasureId: "m19" };
    expect(findRepeatEndingDraftIssue(expanded, draft, model)).toEqual({
      fields: ["endMeasureId"], message: "与既有反复组（第 17–35 小节）相交。把结尾区末小节改到第 16 小节或更早。",
    });
  });

  it("试听修复沿用组和其他房子，缺房不阻止应用", () => {
    const { track, group } = openFixture();
    const missing = { ...group, endings: group.endings.filter(({ passes }) => !passes.includes(2)) };
    const source = { ...track, repeatEndingGroups: [missing] };
    const model = createRepeatEndingDraftModel(source);
    expect(findRepeatEndingDraftIssue(source, missing, model)).toBeUndefined();
    expect(getMissingRepeatEndingPasses(missing)).toEqual([2]);
    const repair = model.create([group.sharedEndMeasureId], group.id, 2)!;
    expect(repair.id).toBe(group.id);
    expect(repair.endings.slice(0, -1)).toEqual(missing.endings);
    expect(repair.endings.at(-1)).toMatchObject({ id: "", startMeasureId: "m6", endMeasureId: "m6", passes: [2] });
    expect(findRepeatEndingDraftIssue(source, repair, model)).toBeUndefined();
  });

  it("草稿为所有房子生成编辑态虚线和范围，成品忽略草稿", () => {
    const { document, group } = openFixture();
    const draft = { ...group, endings: group.endings.map((ending) => ({ ...ending, id: "" })) };
    const editing = buildLayout(document, { purpose: "editing", repeatEndingGroupPreview: draft });
    expect(new Set(editing.systems.flatMap(({ repeatEndingPreview }) => repeatEndingPreview?.map(({ id }) => id) ?? [])).size).toBe(3);
    expect(editing.systems.flatMap(({ repeatEndingGroupPreview }) => repeatEndingGroupPreview?.map(({ kind }) => kind) ?? []))
      .toEqual(["shared", "shared", "shared", "ending", "ending", "ending", "ending", "ending"]);
    const output = buildLayout(document, { purpose: "presentation", repeatEndingGroupPreview: draft });
    expect(output.systems.every((system) => !system.repeatEndingGroupPreview && !system.repeatEndingPreview)).toBe(true);
  });
});
