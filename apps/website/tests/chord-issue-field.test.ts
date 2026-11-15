import { describe, expect, it } from "vitest";
import { copyChordPreset } from "@liuxianmao/lxm-editor";
import { chordIssueField } from "../components/EditorShell/chords/chord-issue-field";

describe("和弦错误字段定位", () => {
  it("合法图不定位，窗口错误定位起始品位", () => {
    const diagram = copyChordPreset("C")!.diagram!;
    expect(chordIssueField(diagram)).toBeNull();
    diagram.startFret = Number.NaN;
    expect(chordIssueField(diagram)).toBe("起始品位");
  });
  it("重复手指不再视为冲突", () => {
    const diagram = copyChordPreset("C")!.diagram!;
    diagram.strings[4]!.finger = 2;
    expect(chordIssueField(diagram)).toBeNull();
  });
  it("定位无效的实际品位、手指以及可修改的空弦控件", () => {
    const diagram = copyChordPreset("C")!.diagram!;
    diagram.strings[2]!.fret = 25;
    expect(chordIssueField(diagram)).toBe("3弦品位");
    diagram.strings[2]!.fret = 0;
    Object.assign(diagram.strings[1]!, { finger: 8 });
    expect(chordIssueField(diagram)).toBe("2弦手指");
    diagram.strings[1]!.finger = 1;
    diagram.strings[2]!.finger = 1;
    expect(chordIssueField(diagram)).toBe("3弦品位");
  });
  it("定位具体横按字段，不误聚焦第一组", () => {
    const diagram = copyChordPreset("F")!.diagram!;
    diagram.barres.push({ ...diagram.barres[0]!, fret: Number.NaN });
    expect(chordIssueField(diagram)).toBe("横按2fret");
  });
});
