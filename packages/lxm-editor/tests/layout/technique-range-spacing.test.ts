import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp2.json";
import { buildLayout, hitTestTechnique } from "../../src/layout";
import { getTechniqueInkBounds } from "../../src/layout/technique-geometry";
import { techniqueInkIntersects } from "../../src/layout/technique-curve-placement";
import type { ILXMTechnique } from "../../src/core/types";

const fixture = (type: "palmMute" | "letRing") => {
  const document = structuredClone(source);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  const measure = track.measures[0]!;
  measure.chordSymbols = [];
  measure.beats = [3, 5, 2, 4].map((fret, i) => ({
    id: `range-beat-${i}`, tick: i * 960,
    rhythm: { base: "quarter" as const, dots: 0 }, kind: "notes" as const,
    notes: [{ id: `range-note-${i}`, string: 1, fret }],
  }));
  track.techniques = [
    { id: "range", type, fromBeatId: "range-beat-0", toBeatId: "range-beat-3" },
    { id: "h", type: "hammerOn", fromNoteId: "range-note-0", toNoteId: "range-note-1" },
    { id: "p", type: "pullOff", fromNoteId: "range-note-1", toNoteId: "range-note-2" },
  ] satisfies ILXMTechnique[];
  return document;
};

describe("区间技巧回收整档避让的多余空白", () => {
  it.each(["palmMute", "letRing"] as const)("%s 在最终 H/P 上方保留 4 单位净空", (type) => {
    for (const density of ["compact", "comfortable"] as const) {
      for (const purpose of ["editing", "presentation"] as const) {
        const document = fixture(type);
        const before = structuredClone(document);
        const layout = buildLayout(document, { density, purpose });
        const segments = layout.systems[0]!.techniques;
        const range = segments.find((segment) => segment.techniqueId === "range")!;
        const localInk = segments.filter((segment) => segment.techniqueId !== "range")
          .flatMap(getTechniqueInkBounds);
        const gaps = getTechniqueInkBounds(range).flatMap((piece) => localInk
          .filter((other) => piece.x < other.x + other.width && piece.x + piece.width > other.x)
          .map((other) => other.y - piece.y - piece.height));
        expect(Math.min(...gaps)).toBeCloseTo(4, 10);
        expect(hitTestTechnique(layout, { x: range.texts[0]!.x, y: range.texts[0]!.y - 3 })).toBe("range");
        const reversed = structuredClone(document);
        reversed.score.tracks[0]!.techniques.reverse();
        expect(buildLayout(reversed, { density, purpose })).toEqual(layout);
        expect(document).toEqual(before);
      }
    }
  });

  it("虚线末端也避让后方更高的技巧，不只看起点 H", () => {
    const document = fixture("palmMute");
    document.score.tracks[0]!.techniques.push({
      id: "bend-at-end", type: "bend", fromNoteId: "range-note-3", semitones: 2,
    });
    const layout = buildLayout(document);
    const segments = layout.systems[0]!.techniques;
    const range = segments.find((segment) => segment.techniqueId === "range")!;
    for (const other of segments.filter((segment) => segment.techniqueId !== "range")) {
      expect(techniqueInkIntersects(range, other)).toBe(false);
    }
  });
});
