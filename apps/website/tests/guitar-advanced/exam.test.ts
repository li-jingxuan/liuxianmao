import { describe, expect, it } from "vitest";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_EXAM as exam,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initial,
} from "../../data/guitar-advanced";
import {
  createExamAttempt,
  getBestExamScore,
  getExamReadiness,
  getLatestExamAttempt,
  gradeExamAttempt,
  setExamAnswer,
  setExamQuestionIndex,
  submitExamAttempt,
  validateExamContent,
} from "../../lib/guitar-advanced/exam";
import type { ExamAttempt, GuitarAdvancedExam, GuitarProgressV4 } from "../../lib/guitar-advanced/model";

const time = "2026-10-18T12:00:00.000Z";
const completed = (): GuitarProgressV4 => ({
  ...initial,
  completedLessonIds: data.lessons.map((lesson) => lesson.id),
  completedExerciseIds: data.exercises.map((exercise) => exercise.id),
});
const allCorrectAttempt = (id = "attempt-1") => {
  let attempt = createExamAttempt(exam, id, time);
  for (const question of attempt.questionSnapshot) {
    const updated = setExamAnswer(attempt, question.id, question.answer, time);
    if (!updated.ok) throw new Error("fixture answer must be valid");
    attempt = updated.value;
  }
  return attempt;
};
const scoreForQuestionIds = (correctIds: readonly string[]): ExamAttempt => {
  let attempt = createExamAttempt(exam, "attempt-score", time);
  for (const question of attempt.questionSnapshot) {
    let answer = question.answer;
    if (!correctIds.includes(question.id)) {
      if (question.type === "singleChoice") {
        answer = { type: "singleChoice", optionId: question.options.find((option) => option.id !== question.answer.optionId)!.id };
      } else if (question.type === "multipleChoice") {
        answer = { type: "multipleChoice", optionIds: [] };
      } else if (question.type === "ordering") {
        answer = { type: "ordering", orderedIds: [...question.answer.orderedIds].reverse() };
      } else {
        answer = { type: "targetSelection", targetIds: [] };
      }
    }
    if (answer.type === "multipleChoice" && !answer.optionIds.length) continue;
    if (answer.type === "targetSelection" && !answer.targetIds.length) continue;
    const updated = setExamAnswer(attempt, question.id, answer, time);
    if (!updated.ok) throw new Error(`fixture answer invalid: ${question.id}`);
    attempt = updated.value;
  }
  return attempt;
};

describe("fixed guitar comprehensive exam", () => {
  it("has twelve unique questions balanced across modules and exact score weights", () => {
    expect(exam.questions).toHaveLength(12);
    expect(new Set(exam.questions.map((question) => question.id)).size).toBe(12);
    for (const guitarModule of data.modules) {
      const questions = exam.questions.filter((question) => question.moduleId === guitarModule.id);
      expect(questions).toHaveLength(3);
      expect(questions.reduce((sum, question) => sum + question.points, 0)).toBe(25);
      expect(questions.every((question) => data.lessons.some((lesson) => lesson.id === question.relatedLessonId))).toBe(true);
    }
    expect(exam.questions.reduce((sum, question) => sum + question.points, 0)).toBe(100);
    expect(validateExamContent(exam, data)).toEqual([]);
  });

  it("rejects a broken theory reference or altered fixed exam contract", () => {
    const brokenReference = {
      ...exam,
      questions: exam.questions.map((question, index) =>
        index === 0 ? { ...question, relatedLessonId: "missing-lesson" } : question,
      ),
    } as unknown as GuitarAdvancedExam;
    expect(validateExamContent(brokenReference, data)).toContain(
      "exam-rhythm-note-value: 理论引用 missing-lesson 缺失或模块不匹配",
    );
    expect(validateExamContent({ ...exam, passingScore: 75 }, data)).toContain(
      "考试题数、顺序或分值不符合 R5 固定契约",
    );
  });

  it("unlocks only after every unique theory and exercise item is complete", () => {
    expect(getExamReadiness(data, initial).eligible).toBe(false);
    expect(getExamReadiness(data, initial).pendingTargets).toHaveLength(14);
    const ready = completed();
    expect(getExamReadiness(data, ready)).toEqual({ eligible: true, pendingTargets: [] });
    expect(getExamReadiness(data, { ...ready, completedExerciseIds: ready.completedExerciseIds.slice(1) }).eligible).toBe(false);
  });

  it("creates an empty isolated draft and snapshots the fixed question order", () => {
    const attempt = createExamAttempt(exam, "attempt-1", time);
    expect(attempt.answers).toEqual({});
    expect(attempt.currentQuestionIndex).toBe(0);
    expect(attempt.questionSnapshot.map((question) => question.id)).toEqual(exam.questions.map((question) => question.id));
    expect(attempt.passingScore).toBe(80);
    expect(attempt.status).toBe("draft");
  });

  it("accepts wrong answers, rejects malformed answers and stores exact sets", () => {
    const attempt = createExamAttempt(exam, "attempt-1", time);
    const single = attempt.questionSnapshot[0]!;
    const wrong = setExamAnswer(attempt, single.id, { type: "singleChoice", optionId: "half-beat" }, time);
    expect(wrong.ok).toBe(true);
    const malformed = setExamAnswer(attempt, single.id, { type: "singleChoice", optionId: "unknown" }, time);
    expect(malformed).toEqual({ ok: false, reason: "invalidAnswer" });
    const multi = attempt.questionSnapshot.find((question) => question.type === "multipleChoice")!;
    const empty = setExamAnswer(attempt, multi.id, { type: "multipleChoice", optionIds: [] }, time);
    expect(empty.ok && empty.value.answers[multi.id]).toBeUndefined();
  });

  it("grades unattempted questions as zero and reports per-module totals", () => {
    const result = gradeExamAttempt(createExamAttempt(exam, "attempt-1", time), exam);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grade.score).toBe(0);
    expect(result.grade.unansweredQuestionIds).toHaveLength(12);
    expect(Object.values(result.grade.moduleScores)).toEqual([0, 0, 0, 0]);
    expect(result.grade.passed).toBe(false);
  });

  it("scores 75 as failing and 84 as passing using the fixed 9/8/8 weights", () => {
    const questions = exam.questions;
    const fail = gradeExamAttempt(scoreForQuestionIds(questions.filter((question) => question.moduleId !== "playing-techniques").map((question) => question.id)), exam);
    expect(fail.ok && fail.grade.score).toBe(75);
    expect(fail.ok && fail.grade.passed).toBe(false);
    const pass = gradeExamAttempt(scoreForQuestionIds([...questions.filter((question) => question.moduleId !== "playing-techniques").map((question) => question.id), questions[9]!.id]), exam);
    expect(pass.ok && pass.grade.score).toBe(84);
    expect(pass.ok && pass.grade.passed).toBe(true);
  });

  it("moves only within question bounds and freezes the submitted attempt idempotently", () => {
    const attempt = allCorrectAttempt();
    expect(setExamQuestionIndex(attempt, 12, time)).toEqual({ ok: false, reason: "notFound" });
    const submitted = submitExamAttempt(attempt, exam, time);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value.status).toBe("submitted");
    expect(submitted.value.score).toBe(100);
    expect(submitExamAttempt(submitted.value, exam, "later")).toEqual({ ok: true, value: submitted.value, alreadySubmitted: true });
  });

  it("derives best and latest score deterministically", () => {
    const first = submitExamAttempt(allCorrectAttempt("a"), exam, "2026-10-18T10:00:00.000Z");
    const second = submitExamAttempt(createExamAttempt(exam, "b", time), exam, "2026-10-18T13:00:00.000Z");
    if (!first.ok || !second.ok) throw new Error("fixture submission failed");
    expect(getBestExamScore([first.value, second.value])).toBe(100);
    expect(getLatestExamAttempt([first.value, second.value])?.id).toBe("b");
  });
});
