import { describe, expect, it } from "vitest";
import {
  GUITAR_ADVANCED_DATA,
  GUITAR_ADVANCED_INITIAL_PROGRESS,
} from "../../data/guitar-advanced";
import {
  addExerciseResult,
  getContinueTarget,
  getModuleProgress,
  getOverallProgress,
  markLessonComplete,
} from "../../lib/guitar-advanced/progress";
import { cloneProgress } from "../../lib/guitar-advanced/storage";

describe("guitar progress", () => {
  it("records lesson completion idempotently without mutating the source", () => {
    const initial = cloneProgress(GUITAR_ADVANCED_INITIAL_PROGRESS);
    const once = markLessonComplete(initial, "rhythm-eighth-sixteenth", "now");
    const twice = markLessonComplete(once, "rhythm-eighth-sixteenth", "later");
    expect(initial.completedLessonIds).toEqual([]);
    expect(twice.completedLessonIds).toEqual(["rhythm-eighth-sixteenth"]);
    expect(twice.updatedAt).toBe("later");
  });

  it("counts only available content in module and overall progress", () => {
    const lessonDone = markLessonComplete(
      GUITAR_ADVANCED_INITIAL_PROGRESS,
      "rhythm-eighth-sixteenth",
      "now",
    );
    const rhythmModule = GUITAR_ADVANCED_DATA.modules[0]!;
    expect(getModuleProgress(rhythmModule, lessonDone)).toEqual({
      completed: 1,
      total: 2,
      ratio: 0.5,
    });
    expect(
      getOverallProgress(GUITAR_ADVANCED_DATA.modules, lessonDone),
    ).toEqual({ completed: 1, total: 2, ratio: 0.5 });
  });

  it("records the latest attempt and selects the next incomplete item", () => {
    const exerciseDone = addExerciseResult(
      GUITAR_ADVANCED_INITIAL_PROGRESS,
      {
        exerciseId: "rhythm-identify-eighth-notes",
        selectedOptionId: "once-per-beat",
        isCorrect: false,
        submittedAt: "now",
      },
      "now",
    );
    expect(exerciseDone.completedExerciseIds).toEqual([
      "rhythm-identify-eighth-notes",
    ]);
    expect(
      getContinueTarget(
        GUITAR_ADVANCED_DATA.modules,
        GUITAR_ADVANCED_DATA.lessons,
        GUITAR_ADVANCED_DATA.exercises,
        exerciseDone,
      ),
    ).toEqual({ kind: "lesson", id: "rhythm-eighth-sixteenth" });
  });
});
