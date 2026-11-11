import { describe, expect, it } from "vitest";
import raw from "./fixtures/progress-v1.json";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initial,
  GUITAR_ADVANCED_SETTINGS as settings,
  GUITAR_ADVANCED_EXAM as exam,
} from "../../data/guitar-advanced";
import { createGuitarProgressStore } from "../../stores/guitar-advanced-store";
import { parseProgress, type ProgressStorage } from "../../lib/guitar-advanced/storage";
import { createExamAttempt, setExamAnswer, submitExamAttempt } from "../../lib/guitar-advanced/exam";
const key = settings.progressStorageKey,
  v3Key = settings.v3ProgressStorageKey,
  v2Key = settings.v2ProgressStorageKey,
  oldKey = settings.legacyProgressStorageKey;
const lesson = "rhythm-eighth-sixteenth",
  exercise = "rhythm-identify-eighth-notes";
const correct = { type: "singleChoice" as const, optionId: "twice-per-beat" };
const memory = () => {
  const values = new Map<string, string>(),
    calls: string[] = [];
  let failRead = false,
    failWrite = false,
    failRemove: string | null = null;
  const storage: ProgressStorage = {
    read: (key) => {
      calls.push(`read:${key}`);
      if (failRead) throw new Error("denied");
      return values.get(key) ?? null;
    },
    write: (key, value) => {
      calls.push(`write:${key}`);
      if (failWrite) throw new Error("quota");
      values.set(key, value);
    },
    remove: (key) => {
      calls.push(`remove:${key}`);
      if (failRemove === key) throw new Error("denied");
      values.delete(key);
    },
  };
  return {
    values,
    calls,
    storage,
    failRead: (v: boolean) => {
      failRead = v;
    },
    failWrite: (v: boolean) => {
      failWrite = v;
    },
    failRemove: (v: string | null) => {
      failRemove = v;
    },
  };
};
const create = (storage: ProgressStorage) =>
  createGuitarProgressStore({
    catalog: data,
    exam,
    initialProgress: initial,
    storage,
    now: () => "2026-10-18T00:00:00.000Z",
    createId: () => "test-attempt-id",
  });
describe("guitar progress persistence", () => {
  it("rejects altered exam passing thresholds and invalid snapshotted answer keys", () => {
    const attempt = createExamAttempt(exam, "attempt-validation", "2026-10-18T00:00:00.000Z");
    const valid = {
      ...initial,
      examAttempts: [attempt],
      activeExamAttemptId: attempt.id,
    };
    expect(parseProgress(JSON.stringify(valid)).ok).toBe(true);

    const wrongPassingScore = {
      ...valid,
      examAttempts: [{ ...attempt, passingScore: 70 }],
    };
    const invalidAnswerKey = {
      ...valid,
      examAttempts: [
        {
          ...attempt,
          questionSnapshot: attempt.questionSnapshot.map((question, index) =>
            index === 0
              ? { ...question, answer: { type: "singleChoice", optionId: "missing-option" } }
              : question,
          ),
        },
      ],
    };
    expect(parseProgress(JSON.stringify(wrongPassingScore)).ok).toBe(false);
    expect(parseProgress(JSON.stringify(invalidAnswerKey)).ok).toBe(false);
  });

  it("validates exam review records against the submitted wrong answer and versioned key", () => {
    const started = createExamAttempt(exam, "attempt-review", "2026-10-18T00:00:00.000Z");
    const question = started.questionSnapshot[0]!;
    if (question.type !== "singleChoice") throw new Error("first question should be single choice");
    const wrongOption = question.options.find((option) => option.id !== question.answer.optionId)!;
    const answered = setExamAnswer(
      started,
      question.id,
      { type: "singleChoice", optionId: wrongOption.id },
      "2026-10-18T00:01:00.000Z",
    );
    if (!answered.ok) throw new Error("fixture answer should be valid");
    const submitted = submitExamAttempt(answered.value, exam, "2026-10-18T00:10:00.000Z");
    if (!submitted.ok) throw new Error("fixture attempt should submit");
    const reviewKey = `${exam.id}:${question.id}`;
    const reviewed = {
      ...initial,
      examAttempts: [submitted.value],
      examQuestionReviews: {
        [reviewKey]: { attemptId: submitted.value.id, reviewedAt: "2026-10-18T00:11:00.000Z" },
      },
    };
    expect(parseProgress(JSON.stringify(reviewed)).ok).toBe(true);
    expect(parseProgress(JSON.stringify({
      ...reviewed,
      examQuestionReviews: {
        [reviewKey]: { attemptId: "missing-attempt", reviewedAt: "2026-10-18T00:11:00.000Z" },
      },
    })).ok).toBe(false);
    expect(parseProgress(JSON.stringify({
      ...reviewed,
      examQuestionReviews: {
        [`${exam.id}:missing-question`]: { attemptId: submitted.value.id, reviewedAt: "2026-10-18T00:11:00.000Z" },
      },
    })).ok).toBe(false);
  });

  it("hydrates once before an early child write and keeps the original v1 source", () => {
    const m = memory();
    const old = JSON.stringify(raw);
    m.values.set(oldKey, old);
    const store = create(m.storage);
    store.getState().setLastVisited({ kind: "lesson", id: lesson });
    store.getState().hydrate();
    expect(store.getState().progress.completedLessonIds).toEqual([lesson]);
    expect(store.getState().notification).toContain("考试功能已开放");
    expect(m.values.get(oldKey)).toBe(old);
    expect(JSON.parse(m.values.get(key)!).schemaVersion).toBe(4);
    expect(m.calls.filter((s) => s === `read:${oldKey}`)).toHaveLength(1);
    expect(create(m.storage).getState().hydrated).toBe(false);
    const reload = create(m.storage);
    reload.getState().hydrate();
    expect(reload.getState().progress).toEqual(store.getState().progress);
  });
  it("prefers existing v4 over v3, v2 and v1, including an empty v4 progress", () => {
    const m = memory();
    m.values.set(oldKey, JSON.stringify(raw));
    m.values.set(key, JSON.stringify(initial));
    m.values.set(v3Key, "invalid-v3-is-not-read");
    m.values.set(v2Key, "invalid-v2-is-not-read");
    const store = create(m.storage);
    store.getState().hydrate();
    expect(store.getState().progress).toEqual(initial);
    expect(m.calls).not.toContain(`read:${oldKey}`);
    expect(m.calls).not.toContain(`read:${v3Key}`);
    expect(m.calls).not.toContain(`read:${v2Key}`);
  });
  it("migrates an intact v3 snapshot to v4 and keeps the source key unchanged", () => {
    const m = memory();
    const v3 = {
      schemaVersion: 3,
      completedLessonIds: [lesson],
      completedExerciseIds: [exercise],
      exerciseResults: {},
      wrongExerciseIds: [exercise],
      reviewedExerciseIds: [],
      lastVisited: { kind: "lesson", id: lesson },
      updatedAt: "2026-10-17T00:00:00.000Z",
      examAttempts: [],
      activeExamAttemptId: null,
    };
    const rawV3 = JSON.stringify(v3);
    m.values.set(v3Key, rawV3);
    const store = create(m.storage);
    store.getState().hydrate();
    expect(store.getState().progress.schemaVersion).toBe(4);
    expect(store.getState().progress.examQuestionReviews).toEqual({});
    expect(store.getState().progress.completedLessonIds).toEqual([lesson]);
    expect(m.values.get(v3Key)).toBe(rawV3);
    expect(m.calls).not.toContain(`read:${v2Key}`);
  });
  it("migrates an intact v2 snapshot to v4 and keeps the source key unchanged", () => {
    const m = memory();
    const v2 = {
      schemaVersion: 2,
      completedLessonIds: [lesson],
      completedExerciseIds: [exercise],
      exerciseResults: {},
      wrongExerciseIds: [exercise],
      reviewedExerciseIds: [],
      lastVisited: { kind: "lesson", id: lesson },
      updatedAt: "2026-10-17T00:00:00.000Z",
    };
    const rawV2 = JSON.stringify(v2);
    m.values.set(v2Key, rawV2);
    const store = create(m.storage);
    store.getState().hydrate();
    expect(store.getState().progress.schemaVersion).toBe(4);
    expect(store.getState().progress.completedLessonIds).toEqual([lesson]);
    expect(store.getState().progress.examAttempts).toEqual([]);
    expect(m.values.get(v2Key)).toBe(rawV2);
    expect(JSON.parse(m.values.get(key)!).activeExamAttemptId).toBeNull();
    expect(m.calls).not.toContain(`read:${oldKey}`);
  });
  it.each([
    "",
    "{broken",
    JSON.stringify({ ...initial, schemaVersion: 2 }),
    JSON.stringify(raw),
  ])("protects existing invalid v4 without falling back: %s", (value) => {
    const m = memory();
    m.values.set(key, value);
    m.values.set(v3Key, JSON.stringify({ schemaVersion: 3 }));
    m.values.set(v2Key, JSON.stringify({ ...initial, schemaVersion: 2 }));
    m.values.set(oldKey, JSON.stringify(raw));
    const store = create(m.storage);
    store.getState().markLessonComplete(lesson);
    expect(store.getState().storageIssue?.kind).toBe("readProtected");
    expect(store.getState().progress.completedLessonIds).toEqual([lesson]);
    expect(store.getState().retryPersist()).toEqual({
      ok: false,
      reason: "readProtected",
    });
    expect(m.values.get(key)).toBe(value);
    expect(m.calls).not.toContain(`read:${v3Key}`);
    expect(m.calls).not.toContain(`read:${oldKey}`);
    expect(m.calls).not.toContain(`read:${v2Key}`);
  });
  it("keeps temporary in-memory work when reading throws", () => {
    const m = memory();
    m.failRead(true);
    const store = create(m.storage);
    expect(store.getState().markLessonComplete(lesson)).toEqual({
      ok: true,
      persisted: false,
    });
    expect(store.getState().storageIssue?.message).toContain("临时学习");
    m.failRead(false);
    store.getState().hydrate();
    expect(store.getState().progress.completedLessonIds).toEqual([lesson]);
    expect(store.getState().retryPersist().ok).toBe(false);
  });
  it("retries the latest memory state after migration writes fail without rehydrating", () => {
    const m = memory();
    m.values.set(oldKey, JSON.stringify(raw));
    m.failWrite(true);
    const store = create(m.storage);
    store.getState().hydrate();
    expect(store.getState().storageIssue?.kind).toBe("writeFailed");
    store.getState().markLessonComplete("chords-triad-construction");
    m.failWrite(false);
    expect(store.getState().retryPersist()).toEqual({
      ok: true,
      persisted: true,
    });
    expect(JSON.parse(m.values.get(key)!).completedLessonIds).toEqual([
      lesson,
      "chords-triad-construction",
    ]);
    expect(store.getState().storageIssue).toBeNull();
    expect(m.calls.filter((s) => s.startsWith("read:"))).toHaveLength(4);
  });
  it("rejects invalid actions and repeated submissions without overwriting a result", () => {
    const m = memory(),
      store = create(m.storage);
    store.getState().hydrate();
    const before = store.getState().progress;
    expect(store.getState().markLessonComplete("missing")).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(store.getState().submitExercise(exercise, null)).toEqual({
      ok: false,
      reason: "unanswered",
    });
    store.getState().setLastVisited({ kind: "exercise", id: lesson });
    expect(store.getState().progress).toBe(before);
    expect(store.getState().submitExercise(exercise, correct)).toEqual({
      ok: true,
      persisted: true,
    });
    const result = store.getState().progress.exerciseResults[exercise];
    expect(
      store
        .getState()
        .submitExercise(exercise, {
          type: "singleChoice",
          optionId: "once-per-beat",
        }),
    ).toEqual({ ok: false, reason: "alreadySubmitted" });
    expect(store.getState().progress.exerciseResults[exercise]).toBe(result);
  });
  it("keeps completion and wrong history when redoing and persists a later review", () => {
    const m = memory(),
      store = create(m.storage);
    store
      .getState()
      .submitExercise(exercise, {
        type: "singleChoice",
        optionId: "once-per-beat",
      });
    store.getState().resetExerciseAttempt(exercise);
    expect(store.getState().progress.completedExerciseIds).toEqual([exercise]);
    expect(store.getState().progress.exerciseResults).toEqual({});
    expect(store.getState().progress.wrongExerciseIds).toEqual([exercise]);
    const reload = create(m.storage);
    reload.getState().hydrate();
    reload.getState().submitExercise(exercise, correct);
    expect(reload.getState().progress.reviewedExerciseIds).toEqual([exercise]);
  });
  it.each([oldKey, v2Key, v3Key, key])(
    "retains memory and stops on failed removal: %s",
    (failedKey) => {
      const m = memory();
      m.values.set(oldKey, JSON.stringify(raw));
      const store = create(m.storage);
      store.getState().hydrate();
      const before = store.getState().progress;
      m.calls.length = 0;
      m.failRemove(failedKey);
      expect(store.getState().clearProgress()).toEqual({
        ok: false,
        reason: "storageFailure",
      });
      expect(store.getState().progress).toBe(before);
      expect(m.calls.filter((s) => s.startsWith("remove:"))).toEqual(
        failedKey === oldKey
          ? [`remove:${oldKey}`]
          : failedKey === v2Key
            ? [`remove:${oldKey}`, `remove:${v2Key}`]
            : failedKey === v3Key
              ? [`remove:${oldKey}`, `remove:${v2Key}`, `remove:${v3Key}`]
              : [`remove:${oldKey}`, `remove:${v2Key}`, `remove:${v3Key}`, `remove:${key}`],
      );
      m.failRemove(null);
      expect(store.getState().clearProgress()).toEqual({
        ok: true,
        persisted: true,
      });
      const reload = create(m.storage);
      reload.getState().hydrate();
      expect(reload.getState().progress).toEqual(initial);
      expect(m.values.size).toBe(0);
    },
  );
  it("does not clear read protection after an unsuccessful reset", () => {
    const m = memory();
    m.values.set(key, "invalid");
    m.failRemove(oldKey);
    const store = create(m.storage);
    store.getState().clearProgress();
    expect(store.getState().retryPersist().ok).toBe(false);
    expect(m.values.get(key)).toBe("invalid");
  });
});
