import { describe, expect, it } from "vitest";
import { GUITAR_ADVANCED_DATA as data } from "../../data/guitar-advanced";
import { validateGuitarAdvancedData } from "../../lib/guitar-advanced/catalog";
import { resolveScoreExample } from "../../lib/guitar-advanced/score-example-adapter";
import {
  prepareExerciseMaterials,
  prepareScore,
} from "../../components/GuitarAdvanced/score-presentation";
describe("guitar v2 content", () => {
  it("publishes the complete JSON catalog with bidirectional references", () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(validateGuitarAdvancedData(data)).toEqual([]);
    expect(
      data.modules.every(
        (m) => m.availability === "available" && m.lessonIds.length === 2,
      ),
    ).toBe(true);
  });
  it("validates and lays out distinct teaching scores through the official loader", () => {
    const counts: number[] = [];
    for (const ref of data.scoreExamples) {
      const resolved = resolveScoreExample(ref, data.teachingDocuments);
      expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
      if (resolved.ok)
        counts.push(
          resolved.document.score.tracks[0]!.measures[0]!.beats.length,
        );
      const ready = prepareScore(ref, data.teachingDocuments);
      expect(ready.ok, JSON.stringify(ready)).toBe(true);
    }
    expect(counts.slice(0, 4)).toEqual([4, 8, 16, 6]);
  });
  it("keeps every exercise's required media ready and blocks missing documents/targets", () => {
    for (const exercise of data.exercises)
      expect(prepareExerciseMaterials(exercise, data).errors).toEqual([]);
    expect(
      prepareExerciseMaterials(data.exercises[0]!, {
        ...data,
        teachingDocuments: {},
      }).ready,
    ).toBe(false);
    expect(
      prepareExerciseMaterials(data.exercises[4]!, { ...data, diagrams: [] })
        .ready,
    ).toBe(false);
    expect(
      prepareExerciseMaterials(data.exercises[1]!, { ...data, stimuli: [] })
        .ready,
    ).toBe(false);
  });
  it("detects dangling course, answer, ordering and media references", () => {
    const broken = structuredClone(data);
    const changed = {
      ...broken,
      lessons: broken.lessons.map((l, i) =>
        i === 0
          ? { ...l, nextLessonId: "missing", exerciseIds: ["missing"] }
          : l,
      ),
      stimuli: [],
    };
    expect(validateGuitarAdvancedData(changed).length).toBeGreaterThan(3);
  });
  it("freezes the independent pentatonic target set and roots", () => {
    const exercise = data.exercises[4]!;
    expect(exercise.answer).toEqual({
      type: "targetSelection",
      targetIds: [
        "string-6-fret-0",
        "string-6-fret-3",
        "string-6-fret-5",
        "string-5-fret-0",
        "string-5-fret-3",
        "string-5-fret-5",
      ],
    });
    expect(
      data.diagrams[0]!.positions.filter((p) => p.noteName === "A").map(
        (p) => p.id,
      ),
    ).toEqual(["string-6-fret-5", "string-5-fret-0"]);
  });
});
