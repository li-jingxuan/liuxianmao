import { describe, expect, it } from "vitest";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_EXAM as exam,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initial,
} from "../../data/guitar-advanced";
import {
  createExamAttempt,
  setExamAnswer,
  submitExamAttempt,
} from "../../lib/guitar-advanced/exam";
import {
  getBestExamAttempt,
  getExamHistory,
  getExamQuestionReviewItems,
  getLearningStage,
  getLatestExamAttempt,
  getProgressSummary,
} from "../../lib/guitar-advanced/results";
import type { ExamAttempt, GuitarProgressV4 } from "../../lib/guitar-advanced/model";

const submitWithFirstAnswer = (id: string, answerCorrect: boolean, time: string): ExamAttempt => {
  const started = createExamAttempt(exam, id, time);
  const question = started.questionSnapshot[0]!;
  if (question.type !== "singleChoice") throw new Error("first question should be single choice");
  const selectedId = answerCorrect
    ? question.answer.optionId
    : question.options.find((option) => option.id !== question.answer.optionId)!.id;
  const answered = setExamAnswer(
    started,
    question.id,
    { type: "singleChoice", optionId: selectedId },
    time,
  );
  if (!answered.ok) throw new Error("test answer is invalid");
  const submitted = submitExamAttempt(answered.value, exam, time);
  if (!submitted.ok) throw new Error("test attempt cannot be submitted");
  return submitted.value;
};
const completedProgress = (): GuitarProgressV4 => ({
  ...initial,
  completedLessonIds: data.lessons.map((lesson) => lesson.id),
  completedExerciseIds: data.exercises.map((exercise) => exercise.id),
});
const submitAllCorrect = (id: string, time: string): ExamAttempt => {
  let attempt = createExamAttempt(exam, id, time);
  for (const question of attempt.questionSnapshot) {
    const answered = setExamAnswer(attempt, question.id, question.answer, time);
    if (!answered.ok) throw new Error("test answer is invalid");
    attempt = answered.value;
  }
  const submitted = submitExamAttempt(attempt, exam, time);
  if (!submitted.ok) throw new Error("test attempt cannot be submitted");
  return submitted.value;
};

describe("R6 result and review selectors", () => {
  it("groups review state by exam version and follows the latest submitted attempt", () => {
    const wrong1 = submitWithFirstAnswer("wrong-1", false, "2026-10-18T10:00:00.000Z");
    const questionId = exam.questions[0]!.id;
    const key = `${exam.id}:${questionId}`;
    const reviewed: GuitarProgressV4 = {
      ...initial,
      examAttempts: [wrong1],
      examQuestionReviews: {
        [key]: { attemptId: wrong1.id, reviewedAt: "2026-10-18T10:01:00.000Z" },
      },
    };
    expect(getExamQuestionReviewItems(data, reviewed, [exam]).find((item) => item.questionId === questionId)?.reviewed).toBe(true);

    const wrong2 = submitWithFirstAnswer("wrong-2", false, "2026-10-18T11:00:00.000Z");
    const nextWrong: GuitarProgressV4 = { ...reviewed, examAttempts: [wrong1, wrong2] };
    const currentItem = getExamQuestionReviewItems(data, nextWrong, [exam]).find((item) => item.questionId === questionId);
    expect(currentItem?.attemptId).toBe(wrong2.id);
    expect(currentItem?.reviewed).toBe(false);

    const corrected = submitWithFirstAnswer("correct-3", true, "2026-10-18T12:00:00.000Z");
    const afterCorrect: GuitarProgressV4 = { ...nextWrong, examAttempts: [wrong1, wrong2, corrected] };
    expect(getExamQuestionReviewItems(data, afterCorrect, [exam]).some((item) => item.questionId === questionId)).toBe(false);
  });

  it("selects latest and best attempt deterministically and keeps versions separate", () => {
    const earlier = submitWithFirstAnswer("attempt-a", true, "2026-10-18T10:00:00.000Z");
    const later = submitWithFirstAnswer("attempt-b", true, "2026-10-18T11:00:00.000Z");
    const otherVersion = { ...later, id: "attempt-c", examId: "guitar-advanced-final-v2", score: 100 };
    const attempts = [earlier, later, otherVersion];
    expect(getLatestExamAttempt(attempts, exam.id)?.id).toBe(later.id);
    expect(getBestExamAttempt(attempts, exam.id)?.id).toBe(later.id);
    expect(getExamHistory(attempts, [exam]).map((item) => item.attemptId)).toEqual([
      "attempt-b",
      "attempt-c",
      "attempt-a",
    ]);
  });

  it("derives learning, exam-ready, and completed stages from completion and submitted passes", () => {
    expect(getLearningStage(data, initial)).toBe("learning");
    const ready = completedProgress();
    expect(getLearningStage(data, ready)).toBe("exam-ready");
    const passed = submitAllCorrect("passed", "2026-10-18T13:00:00.000Z");
    const complete: GuitarProgressV4 = { ...ready, examAttempts: [passed] };
    expect(getLearningStage(data, complete)).toBe("completed");
    const summary = getProgressSummary(data, complete, exam.id, [exam]);
    expect(summary.submittedAttemptCount).toBe(1);
    expect(summary.overall.completed).toBe(summary.overall.total);
  });
});
