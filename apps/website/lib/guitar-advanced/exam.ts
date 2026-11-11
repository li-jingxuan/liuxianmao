import { gradeExercise } from "./grading";
import type {
  ExamAttempt,
  ExamGrade,
  ExamQuestion,
  ExerciseAnswer,
  GuitarAdvancedData,
  GuitarAdvancedExam,
  GuitarModuleId,
  GuitarProgressV2,
  LearningTarget,
} from "./model";
import { getLearningSequence } from "./catalog";

export type ExamReadiness = {
  readonly eligible: boolean;
  readonly pendingTargets: readonly LearningTarget[];
};
export type ExamActionFailure =
  | "notFound"
  | "notReady"
  | "alreadySubmitted"
  | "notActive"
  | "invalidAnswer"
  | "invalidExam";
export type ExamActionResult<T> =
  | { readonly ok: true; readonly value: T; readonly alreadySubmitted?: boolean }
  | { readonly ok: false; readonly reason: ExamActionFailure };
export type ExamGradeResult =
  | { readonly ok: true; readonly grade: ExamGrade }
  | { readonly ok: false; readonly reason: "invalidAttempt" };

/** 解锁直接由 14 个稳定内容 ID 推导，不采用百分比或界面状态。 */
export const getExamReadiness = (
  data: GuitarAdvancedData,
  progress: Pick<GuitarProgressV2, "completedLessonIds" | "completedExerciseIds">,
): ExamReadiness => {
  const completed = new Set([
    ...progress.completedLessonIds,
    ...progress.completedExerciseIds,
  ]);
  const pendingTargets = getLearningSequence(data).filter(
    (target) => !completed.has(target.id),
  );
  return { eligible: pendingTargets.length === 0, pendingTargets };
};

const isExamShapeValid = (exam: GuitarAdvancedExam): boolean => {
  const questions = [...exam.questions].sort((a, b) => a.order - b.order);
  if (
    exam.id !== "guitar-advanced-final-v1" ||
    exam.maxScore !== 100 ||
    exam.passingScore !== 80 ||
    exam.passingScore < 0 ||
    exam.passingScore > exam.maxScore ||
    questions.length !== 12 ||
    questions.some((question, index) => question.order !== index + 1)
  )
    return false;
  const modules: readonly GuitarModuleId[] = [
    "rhythm-and-beat",
    "chords-and-progressions",
    "scales-and-fretboard",
    "playing-techniques",
  ];
  return (
    new Set(questions.map((question) => question.id)).size === 12 &&
    modules.every((moduleId) => {
      const moduleQuestions = questions
        .filter((question) => question.moduleId === moduleId)
        .sort((a, b) => a.order - b.order);
      return (
        moduleQuestions.length === 3 &&
        moduleQuestions.every(
          (question, index) => question.points === [9, 8, 8][index],
        ) &&
        moduleQuestions.reduce((sum, question) => sum + question.points, 0) ===
          25
      );
    }) &&
    questions.reduce((sum, question) => sum + question.points, 0) ===
      exam.maxScore
  );
};

/** 发布前校验题目 ID、标准答案与理论引用，避免固定卷带入断链内容。 */
export const validateExamContent = (
  exam: GuitarAdvancedExam,
  data: GuitarAdvancedData,
): string[] => {
  const errors: string[] = [];
  if (!isExamShapeValid(exam)) errors.push("考试题数、顺序或分值不符合 R5 固定契约");
  const courseIds = new Set([
    ...data.lessons.map((lesson) => lesson.id),
    ...data.exercises.map((exercise) => exercise.id),
  ]);
  for (const question of exam.questions) {
    if (courseIds.has(question.id)) errors.push(`${question.id}: 考试题目 ID 与课程内容冲突`);
    for (const lessonId of [
      question.lessonId,
      question.relatedLessonId,
      ...question.reviewLessonIds,
    ]) {
      const lesson = data.lessons.find((item) => item.id === lessonId);
      if (!lesson || lesson.moduleId !== question.moduleId)
        errors.push(`${question.id}: 理论引用 ${lessonId} 缺失或模块不匹配`);
    }
    const answerCheck = gradeExercise(question, question.answer, "");
    if (!answerCheck.ok || !answerCheck.result.isCorrect)
      errors.push(`${question.id}: 标准答案与题目结构不匹配`);
  }
  return errors;
};

/** 深拷贝当前固定卷，后续恢复与评分都以这份快照为准。 */
export const createExamAttempt = (
  exam: GuitarAdvancedExam,
  attemptId: string,
  now: string,
): ExamAttempt => ({
  id: attemptId,
  examId: exam.id,
  passingScore: exam.passingScore,
  status: "draft",
  questionSnapshot: structuredClone(
    [...exam.questions].sort((a, b) => a.order - b.order),
  ),
  answers: {},
  currentQuestionIndex: 0,
  startedAt: now,
  updatedAt: now,
  submittedAt: null,
  score: null,
  moduleScores: null,
  passed: null,
});

const findDraftQuestion = (
  attempt: ExamAttempt,
  questionId: string,
): ExamQuestion | null =>
  attempt.status === "draft"
    ? (attempt.questionSnapshot.find((question) => question.id === questionId) ??
      null)
    : null;

/** 空的多选/指板集合表示撤销作答，会从答案字典移除。 */
export const setExamAnswer = (
  attempt: ExamAttempt,
  questionId: string,
  answer: ExerciseAnswer,
  now: string,
): ExamActionResult<ExamAttempt> => {
  const question = findDraftQuestion(attempt, questionId);
  if (!question) return { ok: false, reason: "notFound" };
  const ids =
    answer.type === "singleChoice"
      ? [answer.optionId]
      : answer.type === "multipleChoice"
        ? answer.optionIds
        : answer.type === "ordering"
          ? answer.orderedIds
          : answer.targetIds;
  if (
    (answer.type === "multipleChoice" || answer.type === "targetSelection") &&
    ids.length === 0
  ) {
    const answers = { ...attempt.answers };
    delete answers[questionId];
    return {
      ok: true,
      value: { ...attempt, answers, updatedAt: now },
    };
  }
  const graded = gradeExercise(question, answer, now);
  if (!graded.ok) return { ok: false, reason: "invalidAnswer" };
  return {
    ok: true,
    value: {
      ...attempt,
      answers: { ...attempt.answers, [questionId]: structuredClone(answer) },
      updatedAt: now,
    },
  };
};

export const setExamQuestionIndex = (
  attempt: ExamAttempt,
  index: number,
  now: string,
): ExamActionResult<ExamAttempt> => {
  if (attempt.status !== "draft")
    return { ok: false, reason: "alreadySubmitted" };
  if (!Number.isInteger(index) || index < 0 || index >= attempt.questionSnapshot.length)
    return { ok: false, reason: "notFound" };
  return {
    ok: true,
    value: { ...attempt, currentQuestionIndex: index, updatedAt: now },
  };
};

/** 未答题计零分；任何不合法的已保存答案都会拒绝整份评分。 */
export const gradeExamAttempt = (
  attempt: ExamAttempt,
  exam: GuitarAdvancedExam,
): ExamGradeResult => {
  if (
    attempt.examId !== exam.id ||
    attempt.passingScore !== exam.passingScore ||
    !isExamShapeValid({ ...exam, questions: attempt.questionSnapshot })
  )
    return { ok: false, reason: "invalidAttempt" };
  const ids = new Set(attempt.questionSnapshot.map((question) => question.id));
  if (Object.keys(attempt.answers).some((id) => !ids.has(id)))
    return { ok: false, reason: "invalidAttempt" };
  const moduleScores: Record<GuitarModuleId, number> = {
    "rhythm-and-beat": 0,
    "chords-and-progressions": 0,
    "scales-and-fretboard": 0,
    "playing-techniques": 0,
  };
  const unansweredQuestionIds: string[] = [];
  const questionGrades: ExamGrade["questionGrades"][number][] = [];
  for (const question of attempt.questionSnapshot) {
    const answer = attempt.answers[question.id] ?? null;
    const grade = gradeExercise(question, answer, attempt.updatedAt);
    if (!grade.ok && grade.reason !== "unanswered")
      return { ok: false, reason: "invalidAttempt" };
    const isCorrect = grade.ok && grade.result.isCorrect;
    const earnedPoints = isCorrect ? question.points : 0;
    if (!answer) unansweredQuestionIds.push(question.id);
    moduleScores[question.moduleId] += earnedPoints;
    questionGrades.push({
      questionId: question.id,
      moduleId: question.moduleId,
      points: question.points,
      earnedPoints,
      isCorrect,
      answer: answer ? structuredClone(answer) : null,
      correctAnswer: structuredClone(question.answer),
    });
  }
  const score = questionGrades.reduce(
    (sum, question) => sum + question.earnedPoints,
    0,
  );
  return {
    ok: true,
    grade: {
      questionGrades,
      score,
      moduleScores,
      unansweredQuestionIds,
      passed: score >= exam.passingScore,
    },
  };
};

export const submitExamAttempt = (
  attempt: ExamAttempt,
  exam: GuitarAdvancedExam,
  now: string,
): ExamActionResult<ExamAttempt> => {
  if (attempt.status === "submitted")
    return { ok: true, value: attempt, alreadySubmitted: true };
  const result = gradeExamAttempt(attempt, exam);
  if (!result.ok) return { ok: false, reason: "invalidExam" };
  const { grade } = result;
  return {
    ok: true,
    value: {
      ...attempt,
      status: "submitted",
      updatedAt: now,
      submittedAt: now,
      score: grade.score,
      moduleScores: grade.moduleScores,
      passed: grade.passed,
    },
  };
};

export const getBestExamScore = (attempts: readonly ExamAttempt[]): number | null => {
  const submitted = attempts
    .filter((attempt) => attempt.status === "submitted" && attempt.score !== null)
    .map((attempt) => attempt.score as number);
  return submitted.length ? Math.max(...submitted) : null;
};

export const getLatestExamAttempt = (
  attempts: readonly ExamAttempt[],
): ExamAttempt | null =>
  [...attempts]
    .filter((attempt) => attempt.status === "submitted")
    .sort(
      (a, b) =>
        (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "") ||
        a.id.localeCompare(b.id),
    )[0] ?? null;
