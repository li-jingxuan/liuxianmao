import { gradeExercise } from "./grading";
import type {
  ExerciseAnswer,
  ExerciseOption,
  ExamAttempt,
  ExamQuestion,
  GuitarProgress,
  GuitarModuleId,
} from "./model";

/** 同步存储边界；实现可抛出读写异常，由 store 决定保护或重试策略。 */
export interface ProgressStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const modules: readonly GuitarModuleId[] = [
  "rhythm-and-beat",
  "chords-and-progressions",
  "scales-and-fretboard",
  "playing-techniques",
];
const isAnswer = (v: unknown): v is ExerciseAnswer => {
  if (!record(v)) return false;
  switch (v.type) {
    case "singleChoice":
      return typeof v.optionId === "string";
    case "multipleChoice":
      return strings(v.optionIds);
    case "ordering":
      return strings(v.orderedIds);
    case "targetSelection":
      return strings(v.targetIds);
    default:
      return false;
  }
};
const isOptionList = (v: unknown): v is readonly ExerciseOption[] =>
  Array.isArray(v) &&
  v.every(
    (x) =>
      record(x) &&
      typeof x.id === "string" &&
      typeof x.label === "string" &&
      (x.stimulusId === undefined || typeof x.stimulusId === "string"),
  );
const isQuestion = (v: unknown): v is ExamQuestion => {
  if (
    !record(v) ||
    typeof v.id !== "string" ||
    typeof v.lessonId !== "string" ||
    !modules.includes(v.moduleId as GuitarModuleId) ||
    typeof v.title !== "string" ||
    typeof v.prompt !== "string" ||
    typeof v.explanation !== "string" ||
    typeof v.relatedLessonId !== "string" ||
    !strings(v.reviewLessonIds) ||
    !Number.isInteger(v.order) ||
    !Number.isInteger(v.points) ||
    (v.stimulusId !== undefined && typeof v.stimulusId !== "string") ||
    !isAnswer(v.answer)
  )
    return false;
  switch (v.type) {
    case "singleChoice":
    case "multipleChoice":
      return isOptionList(v.options);
    case "ordering":
      return (
        isOptionList(v.items) &&
        strings(v.initialOrderIds) &&
        new Set(v.initialOrderIds).size === v.initialOrderIds.length
      );
    case "targetSelection":
      return (
        typeof v.diagramId === "string" &&
        strings(v.targetIds) &&
        new Set(v.targetIds).size === v.targetIds.length
      );
    default:
      return false;
  }
};
// 快照既要可渲染，也要符合固定卷题数、模块分值和标准答案约束。
const isValidSnapshot = (attempt: ExamAttempt): boolean => {
  const questions = attempt.questionSnapshot;
  if (
    attempt.examId !== "guitar-advanced-final-v1" ||
    attempt.passingScore !== 80 ||
    questions.length !== 12 ||
    new Set(questions.map((q) => q.id)).size !== 12 ||
    questions.some((q, i) => q.order !== i + 1)
  )
    return false;
  for (const moduleId of modules) {
    const group = questions
      .filter((q) => q.moduleId === moduleId)
      .sort((a, b) => a.order - b.order);
    if (
      group.length !== 3 ||
      group.some((question, index) => question.points !== [9, 8, 8][index]) ||
      group.reduce((sum, question) => sum + question.points, 0) !== 25
    )
      return false;
  }
  return (
    questions.reduce((sum, q) => sum + q.points, 0) === 100 &&
    questions.every((question) => {
      const standardAnswer = gradeExercise(question, question.answer, "");
      return standardAnswer.ok && standardAnswer.result.isCorrect;
    })
  );
};
const isAttempt = (v: unknown): v is ExamAttempt => {
  if (
    !record(v) ||
    typeof v.id !== "string" ||
    typeof v.examId !== "string" ||
    !Number.isInteger(v.passingScore) ||
    Number(v.passingScore) < 0 ||
    Number(v.passingScore) > 100 ||
    !["draft", "submitted"].includes(String(v.status)) ||
    !Array.isArray(v.questionSnapshot) ||
    !v.questionSnapshot.every(isQuestion) ||
    !record(v.answers) ||
    !Number.isInteger(v.currentQuestionIndex) ||
    typeof v.startedAt !== "string" ||
    Number.isNaN(Date.parse(v.startedAt)) ||
    typeof v.updatedAt !== "string" ||
    Number.isNaN(Date.parse(v.updatedAt)) ||
    (v.submittedAt !== null &&
      (typeof v.submittedAt !== "string" || Number.isNaN(Date.parse(v.submittedAt)))) ||
    !isValidSnapshot(v as unknown as ExamAttempt)
  )
    return false;
  const attempt = v as unknown as ExamAttempt;
  if (
    attempt.currentQuestionIndex < 0 ||
    attempt.currentQuestionIndex >= attempt.questionSnapshot.length
  )
    return false;
  const byId = new Map(attempt.questionSnapshot.map((question) => [question.id, question]));
  if (
    Object.entries(attempt.answers).some(([id, answer]) => {
      const question = byId.get(id);
      return !question || !isAnswer(answer) || !gradeExercise(question, answer, "").ok;
    })
  )
    return false;
  if (attempt.status === "draft")
    return (
      attempt.submittedAt === null &&
      attempt.score === null &&
      attempt.moduleScores === null &&
      attempt.passed === null
    );
  if (
    attempt.submittedAt === null ||
    !Number.isInteger(attempt.score) ||
    Number(attempt.score) < 0 ||
    Number(attempt.score) > 100 ||
    typeof attempt.passed !== "boolean" ||
    attempt.passed !== (Number(attempt.score) >= attempt.passingScore) ||
    !record(attempt.moduleScores) ||
    modules.some(
      (moduleId) =>
        !Number.isInteger(attempt.moduleScores?.[moduleId]) ||
        Number(attempt.moduleScores?.[moduleId]) < 0 ||
        Number(attempt.moduleScores?.[moduleId]) > 25,
    )
  )
    return false;
  // 不直接信任已保存的汇总分：按快照重算，拒绝与逐题结果不一致的成绩。
  const scores: Record<GuitarModuleId, number> = {
    "rhythm-and-beat": 0,
    "chords-and-progressions": 0,
    "scales-and-fretboard": 0,
    "playing-techniques": 0,
  };
  for (const question of attempt.questionSnapshot) {
    const answer = attempt.answers[question.id];
    if (!answer) continue;
    const grade = gradeExercise(question, answer, attempt.submittedAt);
    if (!grade.ok) return false;
    if (grade.result.isCorrect) scores[question.moduleId] += question.points;
  }
  return (
    modules.every((moduleId) => scores[moduleId] === attempt.moduleScores?.[moduleId]) &&
    Object.values(scores).reduce((sum, score) => sum + score, 0) === attempt.score
  );
};
const isStoredProgress = (v: unknown): v is GuitarProgress => {
  if (
    !record(v) ||
    ![1, 2, 3, 4].includes(Number(v.schemaVersion)) ||
    (v.schemaVersion !== 1 && v.schemaVersion !== 2 && v.schemaVersion !== 3 && v.schemaVersion !== 4)
  )
    return false;
  if (
    !strings(v.completedLessonIds) ||
    !strings(v.completedExerciseIds) ||
    (v.updatedAt !== null && typeof v.updatedAt !== "string")
  )
    return false;
  if (
    v.lastVisited !== null &&
    (!record(v.lastVisited) ||
      !["lesson", "exercise"].includes(String(v.lastVisited.kind)) ||
      typeof v.lastVisited.id !== "string")
  )
    return false;
  if (!record(v.exerciseResults)) return false;
  if (
    v.schemaVersion >= 2 &&
    (!strings(v.wrongExerciseIds) || !strings(v.reviewedExerciseIds))
  )
    return false;
  const baseValid = Object.values(v.exerciseResults).every(
    (r) =>
      record(r) &&
      typeof r.exerciseId === "string" &&
      typeof r.isCorrect === "boolean" &&
      typeof r.submittedAt === "string" &&
      (v.schemaVersion === 1
        ? r.selectedOptionId === null || typeof r.selectedOptionId === "string"
        : isAnswer(r.answer)),
  );
  if (!baseValid || v.schemaVersion < 3) return baseValid;
  if (
    !Array.isArray(v.examAttempts) ||
    !v.examAttempts.every(isAttempt) ||
    (v.activeExamAttemptId !== null && typeof v.activeExamAttemptId !== "string")
  )
    return false;
  const attempts = v.examAttempts as ExamAttempt[];
  if (new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length)
    return false;
  const drafts = attempts.filter((attempt) => attempt.status === "draft");
  // 恢复后只能有一个活动草稿；悬空活动 ID 或多个草稿都视为损坏记录。
  const validActiveDraft = drafts.length === 0
    ? v.activeExamAttemptId === null
    : drafts.length === 1 && v.activeExamAttemptId === drafts[0]?.id;
  if (!validActiveDraft) return false;
  if (v.schemaVersion === 3) return true;
  if (!record(v.examQuestionReviews)) return false;
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  // 复习必须指向已提交批次中的错题或未答题，且时间不能早于提交。
  return Object.entries(v.examQuestionReviews).every(([key, review]) => {
    if (
      !record(review) ||
      typeof review.attemptId !== "string" ||
      typeof review.reviewedAt !== "string" ||
      Number.isNaN(Date.parse(review.reviewedAt))
    )
      return false;
    const attempt = attemptsById.get(review.attemptId);
    if (!attempt || attempt.status !== "submitted" || !attempt.submittedAt) return false;
    const questionId = key.slice(attempt.examId.length + 1);
    if (!key.startsWith(`${attempt.examId}:`) || !questionId) return false;
    const question = attempt.questionSnapshot.find((item) => item.id === questionId);
    if (!question || Date.parse(review.reviewedAt) < Date.parse(attempt.submittedAt)) return false;
    const answer = attempt.answers[questionId] ?? null;
    const grade = gradeExercise(question, answer, attempt.submittedAt);
    return !grade.ok ? grade.reason === "unanswered" : !grade.result.isCorrect;
  });
};
/** null 才是缺失；空字符串也是损坏记录，不能作为新用户覆盖。 */
export const parseProgress = (
  raw: string,
): { ok: true; progress: GuitarProgress } | { ok: false; error: string } => {
  try {
    const value: unknown = JSON.parse(raw);
    return isStoredProgress(value)
      ? { ok: true, progress: value }
      : { ok: false, error: "本地学习记录版本或字段无效" };
  } catch {
    return { ok: false, error: "本地学习记录无法解析" };
  }
};
/** 隔离初始值与实例内存，避免多个 store 共享可变的嵌套记录。 */
export const cloneProgress = <T extends GuitarProgress>(p: T): T =>
  structuredClone(p);
/** SSR 读取视为无记录、写删为空操作；浏览器权限与容量异常保留给 store 处理。 */
export const createBrowserProgressStorage = (): ProgressStorage => ({
  read: (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  write: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  remove: (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
});
