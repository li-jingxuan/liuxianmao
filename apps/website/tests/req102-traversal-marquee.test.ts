import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { TICKS_PER_QUARTER } from "../../../packages/lxm-editor/src/core/constants";
import { buildLayout, hitTestTechniqueTarget } from "../../../packages/lxm-editor/src/layout";
import { getTraversalMarqueeIds } from "../../../packages/lxm-editor-react/src/EditorShell/score/traversal-marquee";

function fixture(systemWidth = 2_000) {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = Array.from({ length: 4 }, (_, index) => {
    const number = index + 1;
    return {
      id: `measure-${number}`,
      timeSignature: { numerator: 4, denominator: 4 },
      barline: "single",
      chordSymbols: [],
      lyrics: [],
      tuplets: [],
      numberedVoice: { events: [], tuplets: [] },
      beats: ["ordinary", "strum", "arpeggio", "pick"].map((kind, beatIndex) => ({
        id: `${kind}-beat-${number}`,
        tick: beatIndex * TICKS_PER_QUARTER,
        kind: "notes",
        rhythm: { base: "quarter", dots: 0 },
        notes: [{ id: `${kind}-note-${number}`, string: 3, fret: 3 }],
      })),
    };
  });
  track.numberedMarks = [];
  track.techniques = [];
  for (let number = track.measures.length; number >= 1; number--) {
    track.techniques.push(
      { id: `pick-${number}`, type: "pickStroke", beatId: `pick-beat-${number}`, stroke: "down" },
      { id: `arpeggio-${number}`, type: "arpeggio", beatId: `arpeggio-beat-${number}`,
        minString: 1, maxString: 4, direction: "ascending" },
      { id: `strum-${number}`, type: "strum", beatId: `strum-beat-${number}`,
        minString: 1, maxString: 4, stroke: "down", showFrets: true },
    );
  }
  const layout = buildLayout(document, { systemWidth, x: 67, y: 250, systemGapY: 220 });
  const measure = layout.systems[0]!.measures[0]!;
  const segment = (id: string) => layout.systems.flatMap((system) => system.techniques)
    .find(({ techniqueId }) => techniqueId === id)!;
  const hit = (start: { x: number; y: number }, end = start) =>
    getTraversalMarqueeIds(layout, document, start, end);
  return { layout, measure, segment, hit };
}

describe("REQ-102 扫弦框选命中", () => {
  it("同一谱行内跨小节命中，反向框选保持谱面拍点顺序", () => {
    const { layout, segment, hit } = fixture();
    expect(layout.systems).toHaveLength(1);
    const { start } = segment("strum-1").focusEndpoints!;
    const { end } = segment("arpeggio-2").focusEndpoints!;
    const expected = ["strum-1", "arpeggio-1", "strum-2", "arpeggio-2"];
    expect(hit(start, end)).toEqual(expected);
    expect(hit(end, start)).toEqual(expected);
  });

  it("跨谱行使用最终几何，重复布局段只返回一次", () => {
    const { layout, segment, hit } = fixture(245);
    expect(layout.systems.length).toBeGreaterThan(1);
    const first = layout.systems[0]!;
    first.techniques.push(segment("strum-1"));
    first.techniques.reverse();
    const start = { x: layout.x, y: layout.y };
    const end = { x: layout.x + layout.width, y: layout.y + layout.height };
    const expected = [
      "strum-1", "arpeggio-1", "strum-2", "arpeggio-2",
      "strum-3", "arpeggio-3", "strum-4", "arpeggio-4",
    ];
    expect(hit(start, end)).toEqual(expected);
    expect(hit(end, start)).toEqual(expected);
  });

  it.each(["strum-1", "arpeggio-1"])("%s 命中箭头外翼和底层点选余量", (id) => {
    const { layout, segment, hit } = fixture();
    const mark = segment(id);
    const triangle = mark.arrowHead?.points ?? mark.path!.arrowPoints!;
    const rightWing = triangle.reduce((right, point) => point[0] > right[0] ? point : right);
    const [x, y] = rightWing;
    expect(x).toBeGreaterThan(mark.focusEndpoints!.end.x);
    expect(hit({ x, y })).toEqual([id]);

    const padded = { x: mark.bounds.x + 0.5, y: mark.visualBounds.y };
    expect(padded.x).toBeLessThan(mark.visualBounds.x);
    expect(hitTestTechniqueTarget(layout, padded)?.techniqueId).toBe(id);
    expect(hit(padded)).toEqual([id]);
  });

  it("命中琶音波纹外缘", () => {
    const { segment, hit } = fixture();
    const wave = segment("arpeggio-1").path!.d.split(" ");
    const [x, y, controlX, controlY, endX, endY] = [1, 2, 4, 5, 6, 7].map((index) => Number(wave[index]));
    const point = { x: (x! + 2 * controlX! + endX!) / 4, y: (y! + 2 * controlY! + endY!) / 4 };
    expect(point.x).toBeLessThan(x!);
    expect(hit(point)).toEqual(["arpeggio-1"]);
  });

  it("琶音斜接箭尖延伸到点选包围框外，箭尖两侧空白无命中", () => {
    const { segment, hit } = fixture();
    const mark = segment("arpeggio-1");
    const [x, y] = mark.arrowHead!.points[0]!;
    const point = { x, y: y - 5 };
    expect(point.y).toBeLessThan(mark.bounds.y);
    expect(hit(point)).toEqual(["arpeggio-1"]);
    expect(hit({ ...point, x: x + 1 })).toEqual([]);
  });

  it.each(["strum", "arpeggio"])("%s 单独命中所属拍点的可见符干", (type) => {
    const { measure, segment, hit } = fixture();
    const id = `${type}-1`;
    const mark = segment(id);
    const stem = measure.durationMarks.find(({ beatId }) => beatId === `${type}-beat-1`)!;
    const y = Math.max(stem.stemY1, stem.stemY2);
    const point = { x: stem.stemX + 2, y };
    expect(y).toBeGreaterThan(mark.bounds.y + mark.bounds.height);
    expect(stem.stemVisible).toBe(true);
    expect(hit(point)).toEqual([id]);
    expect(hit({ x: stem.stemX + 2, y: y + 2 })).toEqual([]);
    stem.stemVisible = false;
    expect(hit(point)).toEqual([]);
  });

  it("普通 TAB 品位、符干及拨片方向均不进入扫弦框选", () => {
    const { measure, segment, hit } = fixture();
    const note = measure.notes.find(({ id }) => id === "ordinary-note-1")!;
    const stem = measure.durationMarks.find(({ beatId }) => beatId === "ordinary-beat-1")!;
    expect(hit({ x: note.x - 1, y: note.y }, { x: stem.stemX + 1, y: stem.stemY2 })).toEqual([]);
    const { x, y, width, height } = segment("pick-1").bounds;
    expect(hit({ x, y }, { x: x + width, y: y + height })).toEqual([]);
  });
});
