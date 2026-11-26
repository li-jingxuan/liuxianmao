import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
  buildScoreScene,
  copyChordPreset,
  EXAMPLE_MVP_7_2_DOCUMENT,
  getMeasureNumberPosition,
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
    expect(coda.x).toBeCloseTo(getMeasureNumberPosition(first!).x);
    const segnoSystem = layout.systems[second!.systemIndex]!;
    expect(segno.x).toBeCloseTo(Math.min(getMeasureNumberPosition(second!).x, segnoSystem.x + segnoSystem.width - segno.bounds.width / 2));
    expect(system.header.leadingBarline).toEqual(before.systems[0]!.header.leadingBarline);
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

  it.each([
    { systemWidth: 1200 },
    { systemWidth: 1200, measureGap: 8 },
    { systemWidth: 60 },
  ])("共线、分隔、换行时使用本节号坐标且不改线 ($systemWidth, $measureGap)", (options) => {
    const { document, measures } = fixture();
    measures[1]!.barline = "repeatEnd";
    const before = buildLayout(document, options);
    measures[1]!.jumpMarks = [{ id: "segno", kind: "segno" }];
    const after = buildLayout(document, options);
    const [previous, marked] = after.systems.flatMap((row) => row.measures);
    const [oldPrevious, oldMarked] = before.systems.flatMap((row) => row.measures);
    expect(getMeasureNumberPosition(previous!).x).toEqual(getMeasureNumberPosition(oldPrevious!).x);
    const number = getMeasureNumberPosition(marked!);
    expect(number.x).toBe(getMeasureNumberPosition(oldMarked!).x);
    const mark = marked!.jumpMarks![0]!;
    const bounds = mark.bounds;
    const row = after.systems[marked!.systemIndex]!;
    expect(mark.x).toBeCloseTo(Math.min(number.x, row.x + row.width - bounds.width / 2));
    expect(bounds.y + bounds.height).toBeLessThan(number.y - 7);
    expect(after.systems.map((system) => system.header.leadingBarline?.type))
      .toEqual(before.systems.map((system) => system.header.leadingBarline?.type));
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
        id: `chord-${index}`, beatId: (index === 1 ? measure.beats.at(-1) : measure.beats[0])!.id,
        display: "nameAndDiagram", chord: copyChordPreset("Am")!,
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
    expect(mark.y - marked!.strings[0]!.y1).toBe(-18);
    expect(chordAnchors(marked!)[0]![1]).toBeLessThan(chordAnchors(before.measures[1]!)[0]![1]!);
    expect(diagram.bounds.y + diagram.bounds.height).toBeLessThan(mark.bounds.y);
    expect(hitTestMusicText(layout, { x: diagram.label.x, y: diagram.label.y })).toMatchObject({ id: diagram.id });
    expect(chordAnchors(previous!)).toEqual(chordAnchors(before.measures[0]!));
    expect(chordAnchors(ordinary!)).toEqual(chordAnchors(before.measures[2]!));
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
