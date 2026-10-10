import { describe, expect, it } from "vitest";
import {
  copyChordPreset,
  getChordDiagramFretCount,
  validateChordDiagram,
  layoutChordDiagram,
  loadDocument,
  applyScoreCommand,
  LXMScoreCommandEnum,
  EXAMPLE_MVP_6_DOCUMENT,
  type ILXMChordDiagram,
} from "../../src";

/** 用不指定手指的自定义指法隔离品格规则，避免横按冲突干扰窗口校验。 */
const customDiagram = (frets: number[], startFret = 1): ILXMChordDiagram => ({
  startFret,
  fretCount: 5,
  strings: [1, 2, 3, 4, 5, 6].map((string, i) => ({
    string: string as 1 | 2 | 3 | 4 | 5 | 6,
    fret: frets[i] ?? "x",
    finger: null,
  })),
  barres: [],
});

describe("和弦按需品格与最大跨度", () => {
  it.each(["C", "F", "G", "Am", "Em"])(
    "真实 %s 指法仅显示三格，横按与文字均包含在外框内",
    (name) => {
      const diagram = copyChordPreset(name)!.diagram;
      expect(validateChordDiagram(diagram)).toBeNull();
      expect(getChordDiagramFretCount(diagram)).toBe(3);
      const layout = layoutChordDiagram(diagram);
      expect(layout.lines.filter((l) => l.x1 === l.x2)).toHaveLength(6);
      expect(layout.lines.filter((l) => l.y1 === l.y2)).toHaveLength(4);
      expect(layout.lines[0]!.y2).toBe(36);
      for (const rect of [
        ...layout.roundedRects,
        ...layout.texts.map((t) => t.bounds),
      ]) {
        expect(rect.y).toBeGreaterThanOrEqual(layout.bounds.y);
        expect(rect.y + rect.height).toBeLessThanOrEqual(
          layout.bounds.y + layout.bounds.height + 0.001,
        );
      }
    },
  );
  it("四格 Bm 与五格高把位可正常显示，旧 fretCount:5 仍合法", () => {
    const bm = copyChordPreset("Bm")!.diagram;
    expect(getChordDiagramFretCount(bm)).toBe(4);
    const high = customDiagram([8, 12, 0], 8);
    expect(validateChordDiagram(high)).toBeNull();
    expect(getChordDiagramFretCount(high)).toBe(5);
    expect(layoutChordDiagram(high).lines[0]!.y2).toBe(60);
    expect(
      layoutChordDiagram(high).texts.some(
        (t) => t.text === "8" && t.textAnchor === "end",
      ),
    ).toBe(true);
  });
  it("空弦与禁奏不算跨度，全部空弦仍显示最少三格", () => {
    const diagram = customDiagram([0, 0, 0]);
    expect(validateChordDiagram(diagram)).toBeNull();
    expect(getChordDiagramFretCount(diagram)).toBe(3);
    expect(getChordDiagramFretCount(customDiagram([8, 10, 0], 8))).toBe(3);
  });
  it("六格自身跨度明确拒绝，五格跨度包含两端并允许", () => {
    expect(validateChordDiagram(customDiagram([2, 7], 2))).toContain(
      "跨度超过 5",
    );
    expect(validateChordDiagram(customDiagram([2, 6], 2))).toBeNull();
  });
  it("窗口问题提示调整起始品位，实际品位不被自动更改", () => {
    const diagram = customDiagram([8, 10]);
    expect(validateChordDiagram(diagram)).toContain("调整起始品位");
    diagram.startFret = 8;
    expect(validateChordDiagram(diagram)).toBeNull();
    expect(diagram.strings[0]!.fret).toBe(8);
    diagram.startFret = 9;
    expect(validateChordDiagram(diagram)).toContain("调整起始品位");
  });
  it("横按品位参与格数和窗口校验", () => {
    const diagram = customDiagram([4, 4, 0]);
    diagram.barres = [{ fret: 4, minString: 1, maxString: 2, finger: 1 }];
    expect(validateChordDiagram(diagram)).toBeNull();
    expect(getChordDiagramFretCount(diagram)).toBe(4);
    diagram.startFret = 5;
    expect(validateChordDiagram(diagram)).toContain("调整起始品位");
  });
  it("加载与提交均拒绝超跨度指法，失败不改变原文档", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const invalid = customDiagram([2, 7], 2);
    const before = JSON.stringify(document);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetChordSymbol,
      trackId: track.id,
      measureId: measure.id,
      beatId: measure.beats[0]!.id,
      display: "nameAndDiagram",
      chord: { name: "custom", diagram: invalid },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(document)).toBe(before);
    measure.chordSymbols[0]!.chord.diagram = invalid;
    expect(loadDocument(JSON.stringify(document)).ok).toBe(false);
  });
});
