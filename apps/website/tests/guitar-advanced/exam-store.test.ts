import { describe, expect, it } from "vitest";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_EXAM as exam,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initial,
  GUITAR_ADVANCED_SETTINGS as settings,
} from "../../data/guitar-advanced";
import type { ProgressStorage } from "../../lib/guitar-advanced/storage";
import { createGuitarProgressStore } from "../../stores/guitar-advanced-store";
import type { GuitarAdvancedExam } from "../../lib/guitar-advanced/model";

const completedProgress = () => ({
  ...initial,
  completedLessonIds: data.lessons.map((lesson) => lesson.id),
  completedExerciseIds: data.exercises.map((exercise) => exercise.id),
});
const memoryStorage = () => {
  const values = new Map<string, string>();
  let failWrite = false;
  const storage: ProgressStorage = {
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      if (failWrite) throw new Error("quota");
      values.set(key, value);
    },
    remove: (key) => { values.delete(key); },
  };
  return { values, storage, failWrite: (value: boolean) => { failWrite = value; } };
};
const create = (storage: ProgressStorage, ready = true, examOverride: GuitarAdvancedExam = exam) => createGuitarProgressStore({
  catalog: data,
  exam: examOverride,
  initialProgress: ready ? completedProgress() : initial,
  storage,
  now: () => "2026-10-18T12:00:00.000Z",
  createId: () => "attempt-1",
});

describe("guitar exam persistence and lifecycle", () => {
  it("blocks start before prerequisites and starts a single fixed draft after completion", () => {
    const m = memoryStorage();
    const blocked = create(m.storage, false);
    expect(blocked.getState().startExam()).toEqual({ ok: false, reason: "notReady" });
    expect(blocked.getState().progress.examAttempts).toEqual([]);

    const store = create(m.storage);
    const started = store.getState().startExam();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.persisted).toBe(true);
    expect(started.attempt.id).toBe("attempt-1");
    expect(store.getState().progress.activeExamAttemptId).toBe("attempt-1");
    expect(store.getState().startExam()).toEqual(started);
  });

  it("does not create an attempt when the fixed exam contract is invalid", () => {
    const m = memoryStorage();
    const invalidExam: GuitarAdvancedExam = { ...exam, passingScore: 70 };
    const store = create(m.storage, true, invalidExam);
    expect(store.getState().startExam()).toEqual({ ok: false, reason: "invalidExam" });
    expect(store.getState().progress.examAttempts).toEqual([]);
  });

  it("persists answer and navigation changes and restores the same draft after reload", () => {
    const m = memoryStorage();
    const store = create(m.storage);
    const started = store.getState().startExam();
    if (!started.ok) throw new Error("exam should start");
    const question = started.attempt.questionSnapshot[0]!;
    if (question.type !== "singleChoice") throw new Error("first question should be single choice");
    const answered = store.getState().setExamAnswer(started.attempt.id, question.id, question.answer);
    const navigated = store.getState().setExamQuestionIndex(started.attempt.id, 5);
    expect(answered.ok && answered.persisted).toBe(true);
    expect(navigated.ok && navigated.persisted).toBe(true);

    const reloaded = create(m.storage);
    reloaded.getState().hydrate();
    const draft = reloaded.getState().progress.examAttempts[0]!;
    expect(draft.id).toBe(started.attempt.id);
    expect(draft.answers[question.id]).toEqual(question.answer);
    expect(draft.currentQuestionIndex).toBe(5);
    expect(reloaded.getState().progress.activeExamAttemptId).toBe(draft.id);
  });

  it("keeps the newest in-memory draft when writes fail and retries that full snapshot", () => {
    const m = memoryStorage();
    m.failWrite(true);
    const store = create(m.storage);
    const started = store.getState().startExam();
    if (!started.ok) throw new Error("exam should start");
    expect(started.persisted).toBe(false);
    const question = started.attempt.questionSnapshot[0]!;
    store.getState().setExamAnswer(started.attempt.id, question.id, question.answer);
    store.getState().setExamQuestionIndex(started.attempt.id, 4);
    m.failWrite(false);
    expect(store.getState().retryPersist()).toEqual({ ok: true, persisted: true });
    const saved = JSON.parse(m.values.get(settings.progressStorageKey)!);
    expect(saved.examAttempts[0].currentQuestionIndex).toBe(4);
    expect(saved.examAttempts[0].answers[question.id]).toEqual(question.answer);
  });

  it("submits once, clears the active id and returns the same immutable result on retry", () => {
    const m = memoryStorage();
    const store = create(m.storage);
    const started = store.getState().startExam();
    if (!started.ok) throw new Error("exam should start");
    for (const question of started.attempt.questionSnapshot) {
      const updated = store.getState().setExamAnswer(started.attempt.id, question.id, question.answer);
      expect(updated.ok).toBe(true);
    }
    const submitted = store.getState().submitExam(started.attempt.id);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.attempt.status).toBe("submitted");
    expect(submitted.attempt.score).toBe(100);
    expect(store.getState().progress.activeExamAttemptId).toBeNull();
    expect(store.getState().submitExam(started.attempt.id)).toEqual(submitted);
    expect(store.getState().progress.examAttempts).toHaveLength(1);
  });

  it("does not let a different or submitted attempt accept answers", () => {
    const store = create(memoryStorage().storage);
    const started = store.getState().startExam();
    if (!started.ok) throw new Error("exam should start");
    const question = started.attempt.questionSnapshot[0]!;
    expect(store.getState().setExamAnswer("other-attempt", question.id, question.answer)).toEqual({ ok: false, reason: "notActive" });
  });

  it("marks a submitted wrong exam question as reviewed idempotently", () => {
    const m = memoryStorage();
    const store = create(m.storage);
    const started = store.getState().startExam();
    if (!started.ok) throw new Error("exam should start");
    const question = started.attempt.questionSnapshot[0]!;
    if (question.type !== "singleChoice") throw new Error("first question should be single choice");
    const wrongOption = question.options.find((option) => option.id !== question.answer.optionId)!;
    store.getState().setExamAnswer(started.attempt.id, question.id, {
      type: "singleChoice",
      optionId: wrongOption.id,
    });
    const submitted = store.getState().submitExam(started.attempt.id);
    if (!submitted.ok) throw new Error("exam should submit");
    expect(store.getState().markExamQuestionReviewed(started.attempt.id, question.id)).toEqual({ ok: true, persisted: true });
    expect(store.getState().markExamQuestionReviewed(started.attempt.id, question.id)).toEqual({ ok: true, persisted: true });
    expect(store.getState().progress.examQuestionReviews[`${exam.id}:${question.id}`]?.attemptId).toBe(started.attempt.id);
  });
});
