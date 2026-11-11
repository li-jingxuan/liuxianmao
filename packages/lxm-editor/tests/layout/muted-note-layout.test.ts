import { describe, expect, it } from "vitest";
import document from "../../example/example-muted-note";
import source from "../../example/example-mvp2.json";
import { loadDocument } from "../../src/core/document/loader";
import type { ILXMTechnique } from "../../src/core/types";
import { buildLayout, hitTestLayout } from "../../src/layout";

describe("弹奏标记 x 混合谱布局", () => {
  it.each(["compact", "comfortable"] as const)(
    "%s 密度窄宽断行仍显示并命中范围外的 x，扫弦/琶音统一隐藏范围内品位",
    (density) => {
      const before = structuredClone(document);
      expect(loadDocument(JSON.stringify(document)).ok).toBe(true);
      const track = document.score.tracks[0]!;
      const xIds = track.measures.flatMap((measure) =>
        measure.beats.flatMap((beat) =>
          beat.notes.filter((note) => note.fret === "x" && !track.techniques.some(
            (t) => (t.type === "strum" || t.type === "arpeggio") &&
              t.beatId === beat.id && note.string >= t.minString && note.string <= t.maxString,
          )).map((note) => note.id),
        ),
      );
      expect(xIds.length).toBeGreaterThan(0);
      for (const systemWidth of [300, 733]) {
        const layout = buildLayout(document, { density, systemWidth });
        const notes = layout.systems.flatMap((system) =>
          system.measures.flatMap((measure) => measure.notes),
        );
        expect(
          notes.filter((note) => note.fretText === "x").map((note) => note.id),
        ).toEqual(xIds);
        notes
          .filter((note) => note.fret === "x")
          .forEach((note) => {
            expect(
              hitTestLayout(layout, { x: note.x, y: note.y }),
            ).toMatchObject({ beatId: note.beatId, string: note.string });
          });
        layout.systems
          .flatMap((system) => system.techniques)
          .filter(
            (segment) =>
              segment.type === "strum" || segment.type === "arpeggio",
          )
          .forEach((segment) => {
            const technique = document.score.tracks[0]!.techniques.find(
              (item) => item.id === segment.techniqueId,
            )!;
            if (!("beatId" in technique)) return;
            if (!("minString" in technique)) return;
            expect(notes.filter((note) => note.beatId === technique.beatId &&
              note.string >= technique.minString && note.string <= technique.maxString,
            )).toEqual([]);
          });
        expect(
          layout.systems.flatMap((system) =>
            system.measures.flatMap((measure) => measure.tuplets),
          ),
        ).toHaveLength(1);
      }
      expect(document).toEqual(before);
    },
  );
  it.each([
    "hammerOn", "pullOff", "slideUp", "slideDown", "tie", "bend", "vibrato",
    "naturalHarmonic", "artificialHarmonic", "tapping", "trill",
  ] as const)("x 可布局 %s，保留标记并生成有限几何", (type) => {
    const d = structuredClone(source);
    const track = d.score.tracks[0]!;
    track.measures = track.measures.slice(0, 1);
    track.measures[0]!.beats.forEach((beat, index) => {
      beat.notes = [{ id: `x-${index}`, string: 3, fret: "x" }];
    });
    track.techniques = [{
      id: "x-technique", type, fromNoteId: "x-0",
      ...(["hammerOn", "pullOff", "slideUp", "slideDown", "tie"].includes(type)
        ? { toNoteId: "x-1" } : {}),
      ...(type === "bend" ? { semitones: 2 } : {}),
      ...(type === "trill" ? { auxiliaryFret: 9 } : {}),
    } as ILXMTechnique];
    expect(loadDocument(JSON.stringify(d)).ok).toBe(true);
    for (const systemWidth of [300, 733]) {
      const layout = buildLayout(d, { systemWidth });
      const segments = layout.systems.flatMap((system) => system.techniques);
      expect(segments.length).toBeGreaterThan(0);
      for (const segment of segments) {
        expect(segment.techniqueId).toBe("x-technique");
        expect(Object.values(segment.visualBounds).every(Number.isFinite)).toBe(true);
        expect(segment.path?.d ?? "").not.toMatch(/NaN|Infinity/);
      }
      const note = layout.systems.flatMap((s) => s.measures.flatMap((m) => m.notes)).find((n) => n.id === "x-0")!;
      if (type === "naturalHarmonic") {
        expect(note).toBeUndefined();
        expect(segments.flatMap((s) => s.texts).map((t) => t.text)).toContain("<x>");
      } else {
        expect(note.fret).toBe("x");
        expect(note.fretText).toBe("x");
      }
    }
  });
});
