import { describe, expect, it } from "vitest";
import document from "../../example/example-muted-note";
import { loadDocument } from "../../src/core/loader";
import { buildLayout, hitTestLayout } from "../../src/layout";

describe("闷音混合谱布局", () => {
  it.each(["compact", "comfortable"] as const)(
    "%s 密度窄宽断行仍显示并命中全部 x",
    (density) => {
      const before = structuredClone(document);
      expect(loadDocument(JSON.stringify(document)).ok).toBe(true);
      const xIds = document.score.tracks[0]!.measures.flatMap((measure) =>
        measure.beats.flatMap((beat) =>
          beat.notes.filter((note) => note.fret === "x").map((note) => note.id),
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
            const xNote = notes.find(
              (note) => note.beatId === technique.beatId && note.fret === "x",
            );
            if (xNote)
              expect(
                segment.visualBounds.x + segment.visualBounds.width,
              ).toBeLessThan(xNote.x - 1);
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
});
