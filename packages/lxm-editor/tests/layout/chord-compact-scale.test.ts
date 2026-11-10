import { describe, expect, it } from "vitest";
import {
  buildLayout,
  copyChordPreset,
  EXAMPLE_MVP_6_DOCUMENT,
  hitTestMusicText,
  type ILXMChordDiagram,
} from "../../src";
import {
  layoutChordDiagram,
  scaleChordDiagram,
  translateChordDiagram,
} from "../../src/layout/chord-diagram-layout";
import { createChordBlock } from "../../src/layout/music-text-layout";
import {
  musicTextRequest,
  type ILXMMusicTextMetrics,
  type MusicTextRect,
} from "../../src/layout/music-text-metrics";

// 固定原字号墨迹，验证缩放后的度量换算，而非依赖保守 fallback 的保护框。
const metrics: ILXMMusicTextMetrics = Object.fromEntries([
  ...["1", "2", "3", "4"].map((text) => [
    musicTextRequest(text, 7).key,
    { x: -1.9, y: -5, width: 3.8, height: 5 },
  ]),
  ...["○", "×"].map((text) => [
    musicTextRequest(text, 9).key,
    { x: -3, y: -6, width: 6, height: 6 },
  ]),
  [
    musicTextRequest("8", 9, "end").key,
    { x: -5, y: -6.5, width: 5, height: 6.5 },
  ],
  ...["C", "F", "G", "Am", "Em", "Bm", "High"].map((text) => [
    musicTextRequest(text, 9).key,
    { x: -text.length * 2.5, y: -6.5, width: text.length * 5, height: 6.5 },
  ]),
]);
const symbol = (name: string, diagram = copyChordPreset(name)!.diagram) => ({
  id: "compact-chord",
  beatId: "beat",
  display: "nameAndDiagram" as const,
  chord: { name, diagram },
});
const expectContained = (outer: MusicTextRect, inner: MusicTextRect) => {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.001);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.001);
  expect(inner.x + inner.width).toBeLessThanOrEqual(
    outer.x + outer.width + 0.001,
  );
  expect(inner.y + inner.height).toBeLessThanOrEqual(
    outer.y + outer.height + 0.001,
  );
};

describe("紧凑谱面和弦与侧栏原图隔离", () => {
  it("侧栏保留45宽、9弦距、原横按厚度和7/9号字", () => {
    const raw = layoutChordDiagram(copyChordPreset("F")!.diagram, metrics);
    expect(raw.lines[5]!.x1).toBe(45);
    expect(raw.lines[1]!.x1).toBe(9);
    expect(raw.roundedRects[0]!.height).toBeCloseTo(4 / 0.85);
    expect(raw.texts.filter((t) => t.fill === "white").every((t) => t.fontSize === 7)).toBe(true);
    const open = layoutChordDiagram(copyChordPreset("C")!.diagram, metrics);
    expect(open.texts.filter((t) => !t.fill).every((t) => t.fontSize === 9)).toBe(true);
    expect(scaleChordDiagram(raw, 1)).toEqual(raw);
  });

  it.each(["C", "F", "G", "Am", "Em", "Bm"])(
    "%s使用27宽、5.4弦距、9号名称及9基线间距，字形均在bounds内",
    (name) => {
      const block = createChordBlock(symbol(name), metrics);
      expect(block.label.fontSize).toBe(9);
      expect(block.label.x).toBe(13.5);
      const diagram = block.diagram!;
      expect(diagram.lines[5]!.x1).toBe(27);
      expect(diagram.lines[1]!.x1).toBeCloseTo(5.4);
      expect(diagram.lines[0]!.y1 - block.label.y).toBe(9);
      for (const text of diagram.texts) {
        expect(text.fontSize).toBe(5.5);
        expect(text.key).toBe(
          musicTextRequest(text.text, text.fontSize, text.textAnchor, text.fontWeight, text.fontFamily).key,
        );
        expect(text.measured).toBe(true);
        expectContained(diagram.bounds, text.bounds);
        if (!text.fill && text.textAnchor === "middle") {
          const labelInkBottom = block.label.bounds.y + block.label.bounds.height - 2;
          expect(text.bounds.y + 2 - labelInkBottom).toBeGreaterThanOrEqual(1);
        }
      }
    },
  );

  it("单指与横按的5.5号数字居中，墨迹不穿出承载圆，横按主体3px", () => {
    const raw = layoutChordDiagram(copyChordPreset("F")!.diagram, metrics);
    const before = structuredClone(raw);
    const scaled = scaleChordDiagram(raw, 0.6);
    expect(raw).toEqual(before);
    expect(scaled.roundedRects[0]!.height).toBe(3);
    expect(scaled.circles).toHaveLength(raw.circles.length + raw.roundedRects.length);
    for (const text of scaled.texts.filter((t) => t.fill === "white")) {
      const ink = {
        x: text.bounds.x + 2,
        y: text.bounds.y + 2,
        width: text.bounds.width - 4,
        height: text.bounds.height - 4,
      };
      const circle = scaled.circles.find(
        (c) => Math.abs(c.cx - text.x) < 0.001 &&
          Math.abs(c.cy - (ink.y + ink.height / 2)) < 0.001,
      )!;
      expect(circle).toBeDefined();
      expect(circle.r * 2).toBe(4.8);
      expectContained({ x: circle.cx - circle.r, y: circle.cy - circle.r, width: circle.r * 2, height: circle.r * 2 }, ink);
    }
    const moved = translateChordDiagram(scaled, 73, 41);
    expect(moved.bounds.x).toBeCloseTo(scaled.bounds.x + 73);
    expect(moved.bounds.y).toBeCloseTo(scaled.bounds.y + 41);
    moved.texts.forEach((text) => expectContained(moved.bounds, text.bounds));
  });

  it("高把位五品图保留36高度，左侧把位与空弦符号互不相碰", () => {
    const high: ILXMChordDiagram = {
      startFret: 8,
      fretCount: 5,
      strings: [
        { string: 1, fret: 8, finger: 1 },
        { string: 2, fret: 12, finger: 4 },
        { string: 3, fret: 0, finger: null },
        { string: 4, fret: "x", finger: null },
        { string: 5, fret: "x", finger: null },
        { string: 6, fret: "x", finger: null },
      ],
      barres: [],
    };
    const diagram = createChordBlock(symbol("High", high), metrics).diagram!;
    expect(diagram.lines[0]!.y2 - diagram.lines[0]!.y1).toBe(36);
    const position = diagram.texts.find((t) => t.textAnchor === "end")!;
    const mute = diagram.texts.find((t) => t.x === 0)!;
    expect(position.bounds.x + position.bounds.width - 2).toBeLessThan(mute.bounds.x + 2);
    diagram.texts.forEach((text) => expectContained(diagram.bounds, text.bounds));
  });

  it("纯名称保持9号且以拍点居中", () => {
    const block = createChordBlock({ ...symbol("C"), display: "name" }, metrics);
    expect(block.diagram).toBeNull();
    expect(block.label.fontSize).toBe(9);
    expect(block.label.x).toBe(0);
    expect(block.bounds).toEqual(block.label.bounds);
  });

  it("谱面缩放后图元与名称仍命中同一和弦", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    track.measures = track.measures.slice(0, 1);
    track.techniques = [];
    const measure = track.measures[0]!;
    measure.chordSymbols = [{ ...symbol("F"), beatId: measure.beats[0]!.id }];
    const layout = buildLayout(document, { systemWidth: 800, musicTextMetrics: metrics });
    const block = layout.systems[0]!.measures[0]!.chordSymbols![0]!;
    for (const point of [
      { x: block.label.x, y: block.label.y - 3 },
      ...block.diagram!.circles.map((c) => ({ x: c.cx, y: c.cy })),
      ...block.diagram!.texts.map((t) => ({ x: t.x, y: t.y })),
    ]) expect(hitTestMusicText(layout, point)).toMatchObject({ id: block.id });
  });
});
