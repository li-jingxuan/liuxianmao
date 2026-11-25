import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
  buildScoreScene,
  EXAMPLE_MVP_7_2_DOCUMENT,
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
    expect(coda.x).toBe(system.header.staffX);
    expect(system.header.leadingBarline?.parts[0]).toMatchObject({ kind: "line", x: coda.x });
    expect(segno.x).toBe(second!.strings[0]!.x1);
    expect(first!.numberPosition).toMatchObject({ x: segno.x - 14, y: segno.y + 3 });
    layout.systems.forEach((row) => {
      for (const mark of row.measures.flatMap((measure) => measure.jumpMarks ?? [])) {
        expect(mark.bounds.y).toBeGreaterThanOrEqual(row.y);
        expect(mark.bounds.width).toBeGreaterThan(11);
      }
    });
    const anchors = layout.systems.flatMap((row) => row.measures.map(chordAnchors));
    const originalAnchors = before.systems.flatMap((row) => row.measures.map(chordAnchors));
    expect(anchors.some((measure) => measure.length > 0)).toBe(true);
    anchors.forEach((measure, index) => measure.forEach(([x, y], chord) => {
      expect(x).toBeCloseTo(originalAnchors[index]![chord]![0]!);
      expect(y).toBeCloseTo(originalAnchors[index]![chord]![1]!);
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

  it("换行或小节分隔形成独立的起始线，不挪动前小节编号", () => {
    const { document, measures } = fixture();
    measures[1]!.jumpMarks = [{ id: "segno", kind: "segno" }];
    const wrapped = buildLayout(document, { systemWidth: 60 });
    const [outgoing, incoming] = wrapped.systems;
    expect(outgoing!.measures[0]!.numberPosition).toBeUndefined();
    expect(incoming!.header.leadingBarline?.parts[0]).toMatchObject({ kind: "line", x: incoming!.header.staffX });
    expect(incoming!.measures[0]!.jumpMarks![0]!.x).toBe(incoming!.header.staffX);

    const [first, second] = buildLayout(document, { systemWidth: 1200, measureGap: 8 }).systems[0]!.measures;
    expect(first!.numberPosition).toBeUndefined();
    expect(second!.jumpMarkStartBarline?.parts[0]).toMatchObject({ kind: "line", x: second!.jumpMarks![0]!.x });
  });
});
