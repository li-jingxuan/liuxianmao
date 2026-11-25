import { describe, expect, it } from "vitest";
import {
  buildLayout,
  buildScoreScene,
  EXAMPLE_MVP_7_2_DOCUMENT,
  loadDocument,
  paginateLayout,
  type ILXMNumberedEvent,
  type ILXMNumberedMark,
  type ILXMSystemLayout,
} from "../../src";

const fixture = (count: number) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  document.score.title = "弧线";
  document.score.arranger = "";
  const track = document.score.tracks[0]!;
  const template = track.measures[0]!;
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = Array.from({ length: count }, (_, index) => {
    const measure = structuredClone(template);
    measure.id = `measure-${index}`;
    measure.barline = index === 0 ? "double" : "single";
    measure.beats.forEach((beat, beatIndex) => {
      beat.id = `beat-${index}-${beatIndex}`;
      beat.notes.forEach((note) => {
        note.id = `note-${index}-${beatIndex}-${note.string}`;
      });
    });
    measure.lyrics = [];
    measure.chordSymbols = [];
    measure.numberedVoice = { events: [], tuplets: [] };
    return measure;
  });
  return { document, track };
};

const event = (id: string, tokens: string[], tick = 0): ILXMNumberedEvent => ({
  id,
  kind: "notes",
  tick,
  rhythm: { base: "thirtySecond", dots: 0 },
  items: tokens.map((token, index) => ({ id: `${id}-${index}`, token })),
});
const options = { density: "compact", systemWidth: 100, x: 12 } as const;
const arc = (system: ILXMSystemLayout) =>
  system.numberedMarks!.find((mark) => mark.markId === "across")!;
const coordinates = (system: ILXMSystemLayout) =>
  arc(system)
    .path!.d.split(" ")
    .filter((part) => part !== "M" && part !== "C")
    .map(Number);
const firstLeftEdge = (system: ILXMSystemLayout) => system.leftEdge![0]!.x1;
const innerRightEdge = (system: ILXMSystemLayout) =>
  Math.min(
    ...system.measures
      .at(-1)!
      .barline.parts.map((part) =>
        part.kind === "line"
          ? part.x - part.strokeWidth / 2
          : part.cx - part.radius,
      ),
  );

describe("BUG-081 简谱跨行弧线", () => {
  it.each(["tie", "slur"] as const)(
    "紧凑谱面的 %s 贴近两端小节线，保留音符锚点和高八度点净空",
    (type) => {
      const { document, track } = fixture(2);
      const tie = type === "tie";
      track.measures[0]!.numberedVoice.events = [
        event("from", tie ? ["3", "1''"] : ["1''"], 3720),
      ];
      track.measures[1]!.numberedVoice.events = [
        event("to", tie ? ["3", "1''"] : ["5''"]),
      ];
      const before = buildLayout(document, { ...options, purpose: "editing" });
      const mark: ILXMNumberedMark = tie
        ? { id: "across", type, fromItemId: "from-1", toItemId: "to-1" }
        : { id: "across", type, fromEventId: "from", toEventId: "to" };
      track.numberedMarks = [mark];
      expect(loadDocument(JSON.stringify(document)).ok).toBe(true);

      const { systems } = buildLayout(document, {
        ...options,
        purpose: "editing",
      });
      expect(systems).toHaveLength(2);
      expect(
        systems.map((s) => s.measures.map((m) => m.numberedSlots)),
      ).toEqual(
        before.systems.map((s) => s.measures.map((m) => m.numberedSlots)),
      );
      const [outgoing, incoming] = systems;
      const from = outgoing!.measures[0]!.numberedNotation![0]!;
      const to = incoming!.measures[0]!.numberedNotation![0]!;
      const [startX, startY, , , , rightControlY, rightX, rightY] = coordinates(
        outgoing!,
      );
      const [leftX, leftY, , leftControlY, , , endX, endY] = coordinates(
        incoming!,
      );
      expect(startX).toBe(from.labels[tie ? 1 : 0]!.x);
      expect(endX).toBe(to.labels[tie ? 1 : 0]!.x);
      expect(rightX).toBeGreaterThan(startX!);
      expect(leftX).toBeLessThan(endX!);
      const rightGap = innerRightEdge(outgoing!) - rightX!;
      expect(rightGap).toBeGreaterThan(0.5);
      expect(rightGap).toBeLessThanOrEqual(5.5);
      if (tie) expect(rightGap).toBeLessThan(5.5);
      expect(leftX! - firstLeftEdge(incoming!)).toBeCloseTo(6);
      expect(rightY).toBe(rightControlY);
      expect(leftY).toBe(leftControlY);
      expect(rightY).toBeLessThan(startY!);
      expect(leftY).toBeLessThan(endY!);
      for (const [note, y] of [
        [from, startY!],
        [to, endY!],
      ] as const) {
        const highestDot = Math.min(...note.dots.map((dot) => dot.cy - dot.r));
        expect(highestDot - (y + 0.5)).toBeGreaterThanOrEqual(2);
      }
    },
  );

  it("三行以上的圆滑线跨过无音行，成品分页沿用共享弧段", () => {
    const { document, track } = fixture(4);
    track.measures[0]!.numberedVoice.events = [event("from", ["1"])];
    track.measures[3]!.numberedVoice.events = [event("to", ["5"])];
    track.numberedMarks = [
      { id: "across", type: "slur", fromEventId: "from", toEventId: "to" },
    ];
    expect(loadDocument(JSON.stringify(document)).ok).toBe(true);

    const layout = buildLayout(document, {
      ...options,
      purpose: "presentation",
    });
    expect(layout.systems).toHaveLength(4);
    for (const middle of layout.systems.slice(1, -1)) {
      const [leftX, leftY, , leftControlY, , rightControlY, rightX, rightY] =
        coordinates(middle);
      expect(leftX! - firstLeftEdge(middle)).toBeCloseTo(6);
      expect(innerRightEdge(middle) - rightX!).toBeCloseTo(5.5);
      expect(leftY).toBe(rightY);
      expect(leftControlY).toBe(rightControlY);
      expect(leftControlY).toBeLessThan(leftY!);
      const { bounds } = arc(middle);
      expect(bounds.height).toBeLessThanOrEqual(3);
      expect(bounds.y).toBeGreaterThanOrEqual(middle.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        middle.y + middle.height,
      );
    }
    const pages = paginateLayout(layout);
    expect(pages.ok).toBe(true);
    expect(
      pages.pages.flatMap((page) =>
        page.systems.map(({ systemIndex }) => systemIndex),
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      buildScoreScene(layout).systems.map((system) =>
        system.items.find(
          (item) => item.kind === "path" && item.numberedMarkId === "across",
        ),
      ),
    ).toMatchObject(layout.systems.map((system) => arc(system).path));
  });
});
