import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
  buildScoreScene,
  copyChordPreset,
  EXAMPLE_MVP_7_2_DOCUMENT,
  hitTestMusicText,
  paginateLayout,
  type ILXMMeasureLayout,
} from "../../src";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 3);
  track.techniques = [];
  track.numberedMarks = [];
  return { document, measures: track.measures };
};

const chordAnchors = (measure: ILXMMeasureLayout) =>
  measure.chordSymbols!.map(({ label }) => [label.x, label.y - measure.strings[0]!.y1]);

describe("REQ-105 跳转记号记谱", () => {
  it.each(["editing", "presentation"] as const)("%s 共享符号和指令图元，保留和弦锚点", (purpose) => {
    const { document, measures } = fixture();
    const options = { purpose, systemWidth: A4_CONTENT_WIDTH };
    const before = buildLayout(document, options);
    measures[0]!.jumpMarks = [{ id: "head-coda", kind: "coda" }, { id: "plain-ds", kind: "ds" }];
    measures[1]!.jumpMarks = [{ id: "segno", kind: "segno" }, { id: "to-coda", kind: "toCoda" }];
    measures[2]!.jumpMarks = [{ id: "ds-al-coda", kind: "dsAlCoda" }];

    const layout = buildLayout(document, options);
    const system = layout.systems[0]!;
    const [first, second] = system.measures;
    const coda = first!.jumpMarks![0]!;
    const segno = second!.jumpMarks![0]!;
    expect(coda.x).toBeCloseTo(system.header.staffX + 9);
    expect(system.header.leadingBarline?.parts[0]).toMatchObject({ kind: "line", x: system.header.staffX });
    expect(segno.x).toBeCloseTo(second!.strings[0]!.x1 + 9);
    expect(first!.numberPosition).toEqual({ x: coda.x - 13, y: coda.y + 3 });
    expect(second!.numberPosition).toEqual({ x: segno.x - 13, y: segno.y + 3 });
    expect(layout.systems.flatMap((row) => row.measures)[2]!.numberPosition).toBeUndefined();
    layout.systems.forEach((row) => {
      for (const mark of row.measures.flatMap((measure) => measure.jumpMarks ?? [])) {
        expect(mark.bounds.y).toBeGreaterThanOrEqual(row.y);
        expect(mark.bounds.width).toBeGreaterThan(11);
      }
    });
    const anchors = layout.systems.flatMap((row) => row.measures.map(chordAnchors));
    const originalAnchors = before.systems.flatMap((row) => row.measures.map(chordAnchors));
    expect(anchors.some((measure) => measure.length > 0)).toBe(true);
    anchors.forEach((measure, index) => measure.forEach(([x], chord) => {
      expect(x).toBeCloseTo(originalAnchors[index]![chord]![0]!);
    }));

    const items = buildScoreScene(layout).systems.flatMap((row) => row.items);
    expect(items.filter((item) => item.jumpMarkId === coda.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "circle", cx: coda.x, cy: coda.y, fill: "none" }),
    ]));
    expect(items.filter((item) => item.jumpMarkId === segno.id).map((item) => item.kind))
      .toEqual(["path", "line", "circle", "circle"]);
    expect(items.filter((item) => item.kind === "text" && item.jumpMarkId)).toMatchObject(
      ["D.S.", "To Coda", "D.S. al Coda"].map((text) => ({
        text, fontSize: 11, fontWeight: 400, fontStyle: "italic", textAnchor: "end",
      })),
    );
    expect(paginateLayout(layout).ok).toBe(true);
  });

  it("换行或小节分隔使用独立起始线，前节号仍在原位", () => {
    const { document, measures } = fixture();
    measures[1]!.jumpMarks = [{ id: "segno", kind: "segno" }];
    const wrapped = buildLayout(document, { systemWidth: 60 });
    const [outgoing, incoming] = wrapped.systems;
    expect(outgoing!.measures[0]!.numberPosition).toBeUndefined();
    expect(incoming!.header.leadingBarline?.parts[0]).toMatchObject({ kind: "line", x: incoming!.header.staffX });
    expect(incoming!.measures[0]!.jumpMarks![0]!.x).toBeCloseTo(incoming!.header.staffX + 9);
    expect(incoming!.measures[0]!.numberPosition?.x).toBeCloseTo(incoming!.header.staffX - 4);

    const [first, second] = buildLayout(document, { systemWidth: 1200, measureGap: 8 }).systems[0]!.measures;
    expect(first!.numberPosition).toBeUndefined();
    expect(second!.jumpMarkStartBarline?.parts[0]).toMatchObject({ kind: "line", x: second!.strings[0]!.x1 });
    expect(second!.jumpMarks![0]!.x).toBeCloseTo(second!.strings[0]!.x1 + 9);
  });

  it.each(["editing", "presentation"] as const)("%s 只抬起碰撞和弦图，房子在其上方且末端指令仍贴本节末", (purpose) => {
    const { document, measures } = fixture();
    const track = document.score.tracks[0]!;
    track.repeatEndingGroups = [{
      id: "group", startMeasureId: measures[0]!.id, sharedEndMeasureId: measures[0]!.id,
      endMeasureId: measures[2]!.id, passCount: 2,
      endings: [{ id: "room", startMeasureId: measures[1]!.id, endMeasureId: measures[2]!.id, passes: [1, 2] }],
    }];
    measures.forEach((measure, index) => {
      measure.beats.forEach((beat) => beat.notes.forEach((note) => { note.string = 6; }));
      measure.chordSymbols = [{
        id: `chord-${index}`, beatId: measure.beats[0]!.id, display: "nameAndDiagram", chord: copyChordPreset("Am")!,
      }];
    });
    measures[0]!.jumpMarks = [{ id: "to-coda", kind: "toCoda" }];
    const options = { purpose, systemWidth: A4_CONTENT_WIDTH, density: "compact" } as const;
    const before = buildLayout(document, options).systems[0]!;
    measures[1]!.jumpMarks = [{ id: "coda", kind: "coda" }];
    const layout = buildLayout(document, options);
    const after = layout.systems[0]!;
    expect(after.measures.map(chordAnchors).map((anchors) => anchors[0]![0])).toEqual(
      before.measures.map(chordAnchors).map((anchors) => anchors[0]![0]),
    );
    const [previous, marked, ordinary] = after.measures;
    const mark = marked!.jumpMarks![0]!;
    const diagram = marked!.chordSymbols![0]!;
    expect(mark.y - marked!.strings[0]!.y1).toBe(-13);
    expect(chordAnchors(marked!)[0]![1]).toBeLessThan(chordAnchors(before.measures[1]!)[0]![1]!);
    expect(diagram.bounds.y + diagram.bounds.height).toBeLessThan(mark.bounds.y);
    expect(hitTestMusicText(layout, { x: diagram.label.x, y: diagram.label.y })).toMatchObject({ id: diagram.id });
    expect(chordAnchors(previous!)).toEqual(chordAnchors(before.measures[0]!));
    expect(chordAnchors(ordinary!)).toEqual(chordAnchors(before.measures[2]!));
    expect(ordinary!.numberPosition).toBeUndefined();
    expect(previous!.numberPosition?.x).toBeLessThanOrEqual(marked!.numberPosition!.x - 7);
    expect(previous!.numberPosition?.y).toBeCloseTo(previous!.strings[0]!.y1 - 1);
    const instruction = previous!.jumpMarks![0]!;
    expect(instruction.x).toBeCloseTo(previous!.strings[0]!.x2 - 11);
    expect(instruction.y - previous!.strings[0]!.y1).toBeCloseTo(before.measures[0]!.jumpMarks![0]!.y - before.measures[0]!.strings[0]!.y1);
    const room = after.repeatEndings![0]!;
    expect(room.bounds.y + room.bounds.height).toBeLessThan(diagram.bounds.y);
    const scene = buildScoreScene(layout).systems[0]!;
    expect(scene.items).toContainEqual(expect.objectContaining({ kind: "circle", jumpMarkId: mark.id, cx: mark.x, cy: mark.y }));
    expect(scene.items).toContainEqual(expect.objectContaining({ kind: "text", jumpMarkId: instruction.id, x: instruction.x, textAnchor: "end" }));
    expect(paginateLayout(layout).ok).toBe(true);
  });
});
