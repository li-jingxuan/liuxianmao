import { describe, expect, it } from "vitest";
import {
  GUITAR_ADVANCED_DATA,
  GUITAR_ADVANCED_INITIAL_PROGRESS,
  GUITAR_ADVANCED_SCORE_EXAMPLES,
} from "../../data/guitar-advanced";
import { validateGuitarAdvancedData } from "../../lib/guitar-advanced/catalog";
import { resolveScoreExample } from "../../lib/guitar-advanced/score-example-adapter";

describe("guitar advanced content", () => {
  it("keeps all v1 content JSON serializable and internally consistent", () => {
    expect(() =>
      JSON.parse(JSON.stringify(GUITAR_ADVANCED_DATA)),
    ).not.toThrow();
    expect(validateGuitarAdvancedData(GUITAR_ADVANCED_DATA)).toEqual([]);
  });

  it("opens one module with one theory lesson and one exercise", () => {
    const available = GUITAR_ADVANCED_DATA.modules.filter(
      (module) => module.availability === "available",
    );
    expect(available).toHaveLength(1);
    expect(available[0]?.lessonIds).toHaveLength(1);
    expect(available[0]?.exerciseIds).toHaveLength(1);
  });

  it("keeps default progress empty and JSON-shaped", () => {
    expect(
      JSON.parse(JSON.stringify(GUITAR_ADVANCED_INITIAL_PROGRESS)),
    ).toEqual({
      schemaVersion: 1,
      completedLessonIds: [],
      completedExerciseIds: [],
      exerciseResults: {},
      lastVisited: null,
      updatedAt: null,
    });
  });

  it("resolves teaching score references through the official document loader", () => {
    for (const reference of GUITAR_ADVANCED_SCORE_EXAMPLES) {
      const result = resolveScoreExample(reference);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const measures = result.document.score.tracks.flatMap(
          (track) => track.measures,
        );
        expect(measures).toHaveLength(1);
        expect(measures[0]?.beats).toHaveLength(8);
        expect(
          measures[0]?.beats.every((beat) => beat.rhythm.base === "eighth"),
        ).toBe(true);
      }
    }
  });
});
