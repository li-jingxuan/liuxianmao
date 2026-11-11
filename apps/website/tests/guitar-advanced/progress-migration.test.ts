import { describe, expect, it } from "vitest";
import raw from "./fixtures/progress-v1.json";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initial,
} from "../../data/guitar-advanced";
import { parseProgress } from "../../lib/guitar-advanced/storage";
import {
  migrateProgressV1ToV4,
  migrateProgressV1ToV3,
  migrateProgressV3ToV4,
  migrateProgressV1ToV2,
  normalizeProgress,
} from "../../lib/guitar-advanced/progress-migration";
const legacy = () => {
  const parsed = parseProgress(JSON.stringify(raw));
  if (!parsed.ok || parsed.progress.schemaVersion !== 1)
    throw new Error("invalid v1 fixture");
  return parsed.progress;
};
describe("guitar v1 to v2 migration", () => {
  it("preserves valid v1 completion, answer and wrong history", () => {
    const p = migrateProgressV1ToV2(legacy(), data);
    expect(p.completedLessonIds).toEqual(raw.completedLessonIds);
    expect(p.completedExerciseIds).toEqual(raw.completedExerciseIds);
    expect(p.exerciseResults["rhythm-identify-eighth-notes"]?.answer).toEqual({
      type: "singleChoice",
      optionId: "once-per-beat",
    });
    expect(p.wrongExerciseIds).toEqual(raw.completedExerciseIds);
    expect(p.updatedAt).toBe(raw.updatedAt);
    expect(normalizeProgress(p, data)).toEqual(p);
  });
  it("does not invent wrong history for old correct answers and retains redo completion", () => {
    const p = legacy(),
      r = p.exerciseResults["rhythm-identify-eighth-notes"]!;
    const correct = migrateProgressV1ToV2(
      {
        ...p,
        exerciseResults: {
          [r.exerciseId]: {
            ...r,
            selectedOptionId: "twice-per-beat",
            isCorrect: true,
          },
        },
      },
      data,
    );
    expect(correct.wrongExerciseIds).toEqual([]);
    const redo = migrateProgressV1ToV2({ ...p, exerciseResults: {} }, data);
    expect(redo.completedExerciseIds).toEqual(raw.completedExerciseIds);
    expect(redo.exerciseResults).toEqual({});
    const empty = migrateProgressV1ToV2(
      {
        ...p,
        exerciseResults: { [r.exerciseId]: { ...r, selectedOptionId: null } },
      },
      data,
    );
    expect(empty.exerciseResults).toEqual({});
    expect(empty.wrongExerciseIds).toEqual([r.exerciseId]);
  });
  it("normalizes stale catalog references and recalculates untrusted correctness", () => {
    const p = migrateProgressV1ToV2(legacy(), data),
      r = p.exerciseResults["rhythm-identify-eighth-notes"]!;
    const fixed = normalizeProgress(
      {
        ...p,
        completedLessonIds: [...p.completedLessonIds, "deleted", "deleted"],
        completedExerciseIds: [],
        reviewedExerciseIds: [r.exerciseId, "deleted"],
        exerciseResults: { [r.exerciseId]: { ...r, isCorrect: true } },
      },
      data,
    );
    expect(fixed.completedLessonIds).toEqual(raw.completedLessonIds);
    expect(fixed.completedExerciseIds).toEqual([r.exerciseId]);
    expect(fixed.exerciseResults[r.exerciseId]?.isCorrect).toBe(false);
    expect(fixed.reviewedExerciseIds).toEqual([]);
    expect(
      normalizeProgress(
        {
          ...initial,
          lastVisited: { kind: "exercise", id: "rhythm-eighth-sixteenth" },
        },
        data,
      ).lastVisited,
    ).toBeNull();
  });
  it("protects malformed or unsupported data rather than treating it as empty", () => {
    for (const value of [
      "",
      "{broken",
      JSON.stringify({ schemaVersion: 3 }),
      JSON.stringify({ ...raw, completedLessonIds: 3 }),
    ])
      expect(parseProgress(value).ok).toBe(false);
  });
  it("migrates v3 exam history into v4 without altering attempts", () => {
    const v3 = {
      ...migrateProgressV1ToV3(legacy(), data),
      examAttempts: [],
      activeExamAttemptId: null,
    };
    const upgraded = migrateProgressV3ToV4(v3);
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.examAttempts).toEqual(v3.examAttempts);
    expect(upgraded.completedLessonIds).toEqual(v3.completedLessonIds);
    expect(upgraded.examQuestionReviews).toEqual({});
    expect(parseProgress(JSON.stringify(upgraded))).toEqual({ ok: true, progress: upgraded });
  });
  it("converts v1 directly to v4 while preserving its normalized practice history", () => {
    const upgraded = migrateProgressV1ToV4(legacy(), data);
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.wrongExerciseIds).toEqual(raw.completedExerciseIds);
    expect(upgraded.examQuestionReviews).toEqual({});
  });
});
