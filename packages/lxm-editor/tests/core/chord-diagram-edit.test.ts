import { describe, expect, it } from "vitest";
import { cloneChordDiagram, validateChordDiagram, validateChordDiagramIssues } from "../../src/core/chords/chord-diagram";
import { editChordDiagram, type ChordDiagramEditResult } from "../../src/core/chords/chord-diagram-edit";
import type { ILXMChordDiagram } from "../../src/core/types";

const open = (): ILXMChordDiagram => ({ startFret: 1, fretCount: 5, strings: [1, 2, 3, 4, 5, 6].map((string) => ({ string: string as 1, fret: 0, finger: null })), barres: [] });
const success = (result: ChordDiagramEditResult) => { expect(result.ok).toBe(true); if (!result.ok) throw Error(JSON.stringify(result.issues)); expect(validateChordDiagram(result.diagram)).toBeNull(); return result; };
const fullBarre = () => success(editChordDiagram(open(), { type: "add-barre", barre: { fret: 1, minString: 6, maxString: 1, finger: 1 } })).diagram;

describe("指法编辑的纯原子事务", () => {
  it("以 1→6 保存，规范化横按两端并同步空弦、禁奏、低品与同品手指", () => {
    const before = open(); before.strings[0]!.fret = "x"; before.strings[1]!.fret = 1;
    const snapshot = structuredClone(before);
    const { diagram } = success(editChordDiagram(before, { type: "add-barre", barre: { fret: 2, minString: 6, maxString: 1, finger: 1 } }));
    expect(before).toEqual(snapshot);
    expect(diagram.strings.map((s) => [s.string, s.fret, s.finger])).toEqual([1, 2, 3, 4, 5, 6].map((s) => [s, 2, 1]));
    expect(diagram.barres).toEqual([{ fret: 2, minString: 1, maxString: 6, finger: 1 }]);
    expect(diagram.strings[0]).not.toBe(before.strings[0]);
  });
  it("覆盖更高品保留实际品位与原手指，同横按手指冲突整体拒绝", () => {
    const before = open(); before.strings[2] = { string: 3, fret: 3, finger: 2 };
    const b = { fret: 1, minString: 1, maxString: 6, finger: 1 as const };
    expect(success(editChordDiagram(before, { type: "add-barre", barre: b })).diagram.strings[2]).toEqual(before.strings[2]);
    before.strings[2]!.finger = 1;
    const snapshot = structuredClone(before);
    const result = editChordDiagram(before, { type: "add-barre", barre: b });
    expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "barre-conflict", string: 3, barreIndex: 0 })]) });
    expect(before).toEqual(snapshot);
  });
  it.each([
    { fret: 2, minString: 1, maxString: 6, finger: 1 as const },
    { fret: 1, minString: 2, maxString: 4, finger: 2 as const },
    { fret: 2, minString: 3, maxString: 3, finger: 2 as const },
    { fret: 7, minString: 1, maxString: 2, finger: 2 as const },
    { fret: 2, minString: 0, maxString: 6, finger: 2 as const },
  ])("冲突/非法横按 %j 不变更原 strings/barres", (barre) => {
    const before = fullBarre(), snapshot = structuredClone(before);
    expect(editChordDiagram(before, { type: "add-barre", barre }).ok).toBe(false);
    expect(before).toEqual(snapshot);
  });
  it("删除横按仅清失去解释的重复手指，不改品位，独立手指保留", () => {
    const before = fullBarre(); before.strings[0] = { string: 1, fret: 3, finger: 2 };
    const result = success(editChordDiagram(before, { type: "delete-barre", index: 0 }));
    expect(result.diagram.strings.map((s) => s.fret)).toEqual(before.strings.map((s) => s.fret));
    expect(result.diagram.strings.map((s) => s.finger)).toEqual([2, null, null, null, null, null]);
    expect(result.clearedStrings).toEqual([2, 3, 4, 5, 6]);
  });
  it("删除后仅一根弦仍使用该手指时保留合法独立手指", () => {
    const before = fullBarre(); before.strings.forEach((s, i) => { if (i > 0) s.finger = null; });
    expect(success(editChordDiagram(before, { type: "delete-barre", index: 0 })).diagram.strings[0]!.finger).toBe(1);
  });
  it.each([
    { fret: 1, minString: 2, maxString: 4, finger: 1 as const },
    { fret: 2, minString: 3, maxString: 6, finger: 1 as const },
    { fret: 1, minString: 1, maxString: 6, finger: 2 as const },
  ])("修改横按 %j 先撤旧描述，再原子重建，不当成新增同指横按", (barre) => {
    const before = fullBarre();
    const result = success(editChordDiagram(before, { type: "edit-barre", index: 0, barre }));
    expect(result.diagram.barres).toEqual([barre]);
    for (const s of result.diagram.strings) {
      const covered = s.string >= barre.minString && s.string <= barre.maxString;
      expect(s.fret).toBe(covered ? barre.fret : 1);
      expect(s.finger).toBe(covered ? barre.finger : null);
    }
  });
  it("不同品位横按可覆盖相同弦，删除一条不清另一条的解释", () => {
    const before = fullBarre();
    const two = success(editChordDiagram(before, { type: "add-barre", barre: { fret: 3, minString: 2, maxString: 4, finger: 3 } })).diagram;
    const removed = success(editChordDiagram(two, { type: "delete-barre", index: 0 })).diagram;
    expect(removed.strings.slice(1, 4).map((s) => s.finger)).toEqual([3, 3, 3]);
    expect(removed.barres).toHaveLength(1);
  });
  it("破坏横按的单弦设置定位相关横按并拒绝，不默删横按", () => {
    const before = fullBarre(), snapshot = structuredClone(before);
    const result = editChordDiagram(before, { type: "set-string", string: 6, fret: "x" });
    expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ string: 6, barreIndex: 0, code: "barre-low-fret" })]) });
    expect(before).toEqual(snapshot);
  });
  it("窗口只查看实际品位，不平移；区分超窗和自身跨度超五格", () => {
    const before = open(); before.strings[0]!.fret = 5;
    const moved = success(editChordDiagram(before, { type: "set-window", startFret: 5 })).diagram;
    expect(moved.strings).toEqual(before.strings);
    const outside = validateChordDiagramIssues({ ...moved, startFret: 6 });
    expect(outside).toEqual([expect.objectContaining({ code: "outside-window", string: 1 })]);
    moved.strings[1]!.fret = 11;
    expect(validateChordDiagramIssues(moved).map((i) => i.code)).toContain("span");
  });
  it("非法中间值与 TAB '-' 有字段定位，旧 validator 保持第一条文案", () => {
    const before = open(); before.strings[2]!.fret = Number.NaN;
    before.strings[4]!.fret = "-" as unknown as number;
    const issues = validateChordDiagramIssues(before);
    expect(issues).toEqual([expect.objectContaining({ string: 3, field: "fret" }), expect.objectContaining({ string: 5, field: "fret" })]);
    expect(validateChordDiagram(before)).toBe(issues[0]!.message);
    expect(cloneChordDiagram(before).strings[2]!.fret).toBeNaN();
  });
  it("最多四条横按，超过时失败且保留完整原图", () => {
    const before = open();
    before.strings[0] = { string: 1, fret: 4, finger: 4 };
    before.strings[1] = { string: 2, fret: 4, finger: 4 };
    before.barres = Array.from({ length: 4 }, (_, i) => ({ fret: i + 1, minString: 1, maxString: 2, finger: (i + 1) as 1 }));
    expect(validateChordDiagram(before)).toBeNull();
    const snapshot = structuredClone(before);
    const result = editChordDiagram(before, { type: "add-barre", barre: { fret: 5, minString: 3, maxString: 4, finger: 1 } });
    expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "barre-limit" })]) });
    expect(before).toEqual(snapshot);
  });
});
