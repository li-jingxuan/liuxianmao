import { describe, expect, it } from "vitest";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initial,
} from "../../data/guitar-advanced";
import {
  getLearningSequence,
  findTarget,
} from "../../lib/guitar-advanced/catalog";
import {
  addExerciseResult,
  getContinueTarget,
  getModuleProgress,
  getOverallProgress,
  getNextTarget,
  markLessonComplete,
} from "../../lib/guitar-advanced/progress";
import type {
  ExerciseResult,
  GuitarProgressV4,
} from "../../lib/guitar-advanced/model";
const id = "rhythm-identify-eighth-notes";
const result = (correct: boolean): ExerciseResult => ({
  exerciseId: id,
  answer: {
    type: "singleChoice",
    optionId: correct ? "twice-per-beat" : "once-per-beat",
  },
  isCorrect: correct,
  submittedAt: "now",
});
describe("guitar learning sequence and progress", () => {
  it("counts 14 unique nodes and interleaves shared exercises only after their primary lesson", () => {
    const sequence = getLearningSequence(data);
    expect(sequence).toHaveLength(14);
    expect(sequence.slice(0, 3).map((t) => t.kind)).toEqual([
      "lesson",
      "exercise",
      "lesson",
    ]);
    expect(sequence.slice(8, 11).map((t) => t.id)).toEqual([
      "scales-a-minor-pentatonic",
      "scales-root-note-locations",
      "scales-find-root-notes",
    ]);
    expect(new Set(sequence.map((t) => t.id)).size).toBe(14);
  });
  it("is idempotent and keeps completion independent of correctness", () => {
    const once = markLessonComplete(initial, "rhythm-eighth-sixteenth", "now");
    expect(markLessonComplete(once, "rhythm-eighth-sixteenth", "later")).toBe(
      once,
    );
    expect(initial.completedLessonIds).toEqual([]);
    const wrong = addExerciseResult(once, result(false), "now");
    expect(getModuleProgress(data.modules[0]!, wrong)).toEqual({
      completed: 2,
      total: 4,
      ratio: 0.5,
    });
    expect(getOverallProgress(data.modules, wrong)).toEqual({
      completed: 2,
      total: 14,
      ratio: 2 / 14,
    });
    const correct = addExerciseResult(wrong, result(true), "later");
    expect(correct.wrongExerciseIds).toEqual([id]);
    expect(correct.reviewedExerciseIds).toEqual([id]);
    expect(
      addExerciseResult(correct, result(false), "again").reviewedExerciseIds,
    ).toEqual([]);
  });
  it("matches lastVisited kind and falls back to the first unfinished node", () => {
    const p = {
      ...initial,
      lastVisited: { kind: "exercise" as const, id: "rhythm-eighth-sixteenth" },
    };
    expect(findTarget(data, p.lastVisited)).toBeNull();
    expect(getContinueTarget(data, p)?.id).toBe("rhythm-eighth-sixteenth");
    expect(
      getContinueTarget(data, {
        ...p,
        completedLessonIds: ["rhythm-eighth-sixteenth"],
      })?.kind,
    ).toBe("exercise");
    expect(getContinueTarget(data, initial, "playing-techniques")?.id).toBe(
      "techniques-hammer-pull-slide",
    );
  });
  it("supports cross-module next, earlier omissions, and all-complete empty state", () => {
    const done: GuitarProgressV4 = {
      ...initial,
      completedLessonIds: data.lessons.map((l) => l.id),
      completedExerciseIds: data.exercises.map((e) => e.id),
    };
    expect(getContinueTarget(data, done)).toBeNull();
    expect(getNextTarget(data, done, { kind: "exercise", id })).toBeNull();
    const omitted = {
      ...done,
      completedLessonIds: done.completedLessonIds.filter((x) =>
        x === "chords-triad-construction" ? false : true,
      ),
    };
    expect(
      getNextTarget(data, omitted, {
        kind: "exercise",
        id: "rhythm-identify-beat-structure",
      })?.moduleId,
    ).toBe("chords-and-progressions");
    expect(
      getNextTarget(data, omitted, {
        kind: "exercise",
        id: "techniques-identify-notation",
      })?.id,
    ).toBe("chords-triad-construction");
  });
});
