import { formatExerciseAnswer } from "./grading";
import { gradeExamAttempt } from "./exam";
import { findTarget } from "./catalog";
import {
  getModuleProgress,
  getOverallProgress,
} from "./progress";
import type {
  ExamAttempt,
  ExamGrade,
  ExerciseAnswer,
  GuitarAdvancedData,
  GuitarAdvancedExam,
  GuitarModuleId,
  GuitarProgressV4,
  LearningTarget,
} from "./model";

export type LearningStage = "learning" | "exam-ready" | "completed";

export interface ExamHistoryEntry {
  readonly attemptId: string;
  readonly examId: string;
  readonly title: string;
  readonly score: number;
  readonly maxScore: number;
  readonly passed: boolean;
  readonly submittedAt: string;
}

export interface ExamQuestionReviewItem {
  readonly key: string;
  readonly attemptId: string;
  readonly examId: string;
  readonly questionId: string;
  readonly order: number;
  readonly moduleId: GuitarModuleId;
  readonly moduleTitle: string;
  readonly title: string;
  readonly prompt: string;
  readonly explanation: string;
  readonly userAnswer: ExerciseAnswer | null;
  readonly correctAnswer: ExerciseAnswer;
  readonly userAnswerLabel: string;
  readonly correctAnswerLabel: string;
  readonly submittedAt: string;
  readonly reviewed: boolean;
  readonly theoryTargets: readonly LearningTarget[];
  readonly exerciseTargets: readonly LearningTarget[];
}

export interface ExerciseReviewItem {
  readonly key: string;
  readonly exerciseId: string;
  readonly moduleId: GuitarModuleId;
  readonly moduleTitle: string;
  readonly title: string;
  readonly prompt: string;
  readonly explanation: string;
  readonly latestAnswerLabel: string | null;
  readonly latestWasCorrect: boolean | null;
  readonly reviewed: boolean;
  readonly theoryTargets: readonly LearningTarget[];
  readonly practiceTarget: LearningTarget;
  readonly submittedAt: string | null;
}

export interface ProgressSummary {
  readonly stage: LearningStage;
  readonly overall: ReturnType<typeof getOverallProgress>;
  readonly modules: readonly {
    readonly id: GuitarModuleId;
    readonly title: string;
    readonly completed: number;
    readonly total: number;
    readonly ratio: number;
  }[];
  readonly completedLessonCount: number;
  readonly totalLessonCount: number;
  readonly completedExerciseCount: number;
  readonly totalExerciseCount: number;
  readonly latestAttempt: ExamAttempt | null;
  readonly bestAttempt: ExamAttempt | null;
  readonly submittedAttemptCount: number;
  readonly pendingReviewCount: number;
  readonly reviewedCount: number;
}

const submittedNewestFirst = (attempts: readonly ExamAttempt[]) =>
  [...attempts]
    .filter((attempt) => attempt.status === "submitted")
    .sort(
      (a, b) =>
        (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "") ||
        a.id.localeCompare(b.id),
    );

export const getLatestExamAttempt = (
  attempts: readonly ExamAttempt[],
  examId?: string,
): ExamAttempt | null =>
  submittedNewestFirst(attempts).find(
    (attempt) => !examId || attempt.examId === examId,
  ) ?? null;

/** 同版本内先比较分数，再以提交时间与 ID 保证平局稳定。 */
export const getBestExamAttempt = (
  attempts: readonly ExamAttempt[],
  examId: string,
): ExamAttempt | null =>
  [...attempts]
    .filter(
      (attempt) =>
        attempt.status === "submitted" &&
        attempt.examId === examId &&
        attempt.score !== null,
    )
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "") ||
        a.id.localeCompare(b.id),
    )[0] ?? null;

export const getExamHistory = (
  attempts: readonly ExamAttempt[],
  exams: readonly GuitarAdvancedExam[],
): ExamHistoryEntry[] => {
  const titles = new Map(exams.map((exam) => [exam.id, exam.title]));
  return submittedNewestFirst(attempts).flatMap((attempt) =>
    attempt.score === null || attempt.passed === null || !attempt.submittedAt
      ? []
      : [
          {
            attemptId: attempt.id,
            examId: attempt.examId,
            title: titles.get(attempt.examId) ?? "历史综合考试",
            score: attempt.score,
            maxScore: attempt.questionSnapshot.reduce(
              (sum, question) => sum + question.points,
              0,
            ),
            passed: attempt.passed,
            submittedAt: attempt.submittedAt,
          },
        ],
  );
};

const getReviewTargets = (
  data: GuitarAdvancedData,
  moduleId: GuitarModuleId,
  lessonIds: readonly string[],
) => {
  const uniqueLessonIds = [...new Set(lessonIds)];
  const theoryTargets = uniqueLessonIds.flatMap((id) => {
    const target = findTarget(data, { kind: "lesson", id });
    return target && target.moduleId === moduleId ? [target] : [];
  });
  const validLessonIds = new Set(theoryTargets.map((target) => target.id));
  const exerciseTargets = data.exercises.flatMap((exercise) => {
    if (
      exercise.moduleId !== moduleId ||
      (!validLessonIds.has(exercise.lessonId) &&
        !validLessonIds.has(exercise.relatedLessonId))
    )
      return [];
    const target = findTarget(data, { kind: "exercise", id: exercise.id });
    return target ? [target] : [];
  });
  return { theoryTargets, exerciseTargets };
};

export const getAttemptQuestionReviewItems = (
  data: GuitarAdvancedData,
  attempt: ExamAttempt,
  exam: GuitarAdvancedExam,
  examQuestionReviews: GuitarProgressV4["examQuestionReviews"],
): ExamQuestionReviewItem[] => {
  if (attempt.status !== "submitted") return [];
  const result = gradeExamAttempt(attempt, exam);
  if (!result.ok) return [];
  const grades = new Map(result.grade.questionGrades.map((grade) => [grade.questionId, grade]));
  return attempt.questionSnapshot.flatMap((question) => {
    const grade = grades.get(question.id);
    if (!grade || grade.isCorrect) return [];
    const key = `${attempt.examId}:${question.id}`;
    const reviewTargets = getReviewTargets(data, question.moduleId, [
      question.relatedLessonId,
      ...question.reviewLessonIds,
    ]);
    return [{
      key,
      attemptId: attempt.id,
      examId: attempt.examId,
      questionId: question.id,
      order: question.order,
      moduleId: question.moduleId,
      moduleTitle:
        data.modules.find((module) => module.id === question.moduleId)?.title ??
        question.moduleId,
      title: question.title,
      prompt: question.prompt,
      explanation: question.explanation,
      userAnswer: grade.answer,
      correctAnswer: grade.correctAnswer,
      userAnswerLabel: grade.answer
        ? formatExerciseAnswer(question, grade.answer)
        : "未作答",
      correctAnswerLabel: formatExerciseAnswer(question, grade.correctAnswer),
      submittedAt: attempt.submittedAt ?? attempt.updatedAt,
      reviewed: examQuestionReviews[key]?.attemptId === attempt.id,
      ...reviewTargets,
    }];
  });
};

/** 用历史快照所属的考试定义复核；不拿当前题库替换已提交题目。 */
export const getExamQuestionReviewItems = (
  data: GuitarAdvancedData,
  progress: GuitarProgressV4,
  exams: readonly GuitarAdvancedExam[],
): ExamQuestionReviewItem[] => {
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const latestQuestionAttempt = new Set<string>();
  const items: ExamQuestionReviewItem[] = [];
  for (const attempt of submittedNewestFirst(progress.examAttempts)) {
    const exam = examsById.get(attempt.examId);
    if (!exam) continue;
    const gradeResult = gradeExamAttempt(attempt, exam);
    if (!gradeResult.ok) continue;
    const currentAttemptItems = new Map(
      getAttemptQuestionReviewItems(data, attempt, exam, progress.examQuestionReviews).map((item) => [item.key, item]),
    );
    for (const question of attempt.questionSnapshot) {
      const key = `${attempt.examId}:${question.id}`;
      if (latestQuestionAttempt.has(key)) continue;
      latestQuestionAttempt.add(key);
      const reviewItem = currentAttemptItems.get(key);
      if (reviewItem) items.push(reviewItem);
    }
  }
  return items.sort(
    (a, b) =>
      a.moduleId.localeCompare(b.moduleId) ||
      a.order - b.order ||
      a.examId.localeCompare(b.examId),
  );
};

/** 练习只保留最近一次答案；错误 ID 和已复习 ID 则保留长期复习状态。 */
export const getExerciseReviewItems = (
  data: GuitarAdvancedData,
  progress: GuitarProgressV4,
): ExerciseReviewItem[] =>
  progress.wrongExerciseIds.flatMap((exerciseId) => {
    const exercise = data.exercises.find((item) => item.id === exerciseId);
    if (!exercise) return [];
    const practiceTarget = findTarget(data, { kind: "exercise", id: exercise.id });
    if (!practiceTarget) return [];
    const latest = progress.exerciseResults[exerciseId];
    const reviewTargets = getReviewTargets(data, exercise.moduleId, [
      exercise.relatedLessonId,
      ...exercise.reviewLessonIds,
    ]);
    return [
      {
        key: exercise.id,
        exerciseId: exercise.id,
        moduleId: exercise.moduleId,
        moduleTitle:
          data.modules.find((module) => module.id === exercise.moduleId)?.title ??
          exercise.moduleId,
        title: exercise.title,
        prompt: exercise.prompt,
        explanation: exercise.explanation,
        latestAnswerLabel: latest
          ? formatExerciseAnswer(exercise, latest.answer)
          : null,
        latestWasCorrect: latest?.isCorrect ?? null,
        reviewed: progress.reviewedExerciseIds.includes(exerciseId),
        ...reviewTargets,
        practiceTarget,
        submittedAt: latest?.submittedAt ?? null,
      },
    ];
  });

export const getLearningStage = (
  data: GuitarAdvancedData,
  progress: GuitarProgressV4,
): LearningStage => {
  const overall = getOverallProgress(data.modules, progress);
  if (overall.completed < overall.total) return "learning";
  return progress.examAttempts.some(
    (attempt) => attempt.status === "submitted" && attempt.passed === true,
  )
    ? "completed"
    : "exam-ready";
};

export const getProgressSummary = (
  data: GuitarAdvancedData,
  progress: GuitarProgressV4,
  examId: string,
  exams: readonly GuitarAdvancedExam[],
): ProgressSummary => {
  const modules = data.modules
    .filter((module) => module.availability === "available")
    .map((module) => ({ id: module.id, title: module.title, ...getModuleProgress(module, progress) }));
  const overall = getOverallProgress(data.modules, progress);
  const examItems = getExamQuestionReviewItems(data, progress, exams);
  const exerciseItems = getExerciseReviewItems(data, progress);
  const allReviewItems = [...examItems, ...exerciseItems];
  const latestAttempt = getLatestExamAttempt(progress.examAttempts, examId);
  const bestAttempt = getBestExamAttempt(progress.examAttempts, examId);
  return {
    stage: getLearningStage(data, progress),
    overall,
    modules,
    completedLessonCount: new Set(progress.completedLessonIds).size,
    totalLessonCount: new Set(data.modules.filter((module) => module.availability === "available").flatMap((module) => module.lessonIds)).size,
    completedExerciseCount: new Set(progress.completedExerciseIds).size,
    totalExerciseCount: new Set(data.modules.filter((module) => module.availability === "available").flatMap((module) => module.exerciseIds)).size,
    latestAttempt,
    bestAttempt,
    submittedAttemptCount: progress.examAttempts.filter((attempt) => attempt.status === "submitted" && attempt.examId === examId).length,
    pendingReviewCount: allReviewItems.filter((item) => !item.reviewed).length,
    reviewedCount: allReviewItems.filter((item) => item.reviewed).length,
  };
};

export const getLowestScoringModules = (
  modules: readonly { readonly id: GuitarModuleId; readonly score: number }[],
): GuitarModuleId[] => {
  if (!modules.length) return [];
  const lowest = Math.min(...modules.map((module) => module.score));
  return modules.filter((module) => module.score === lowest).map((module) => module.id);
};

export const getAttemptQuestionGrade = (
  attempt: ExamAttempt,
  exam: GuitarAdvancedExam,
  questionId: string,
): ExamGrade["questionGrades"][number] | null => {
  const result = gradeExamAttempt(attempt, exam);
  return result.ok
    ? result.grade.questionGrades.find((grade) => grade.questionId === questionId) ?? null
    : null;
};
