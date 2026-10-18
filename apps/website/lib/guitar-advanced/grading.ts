import type { Exercise, ExerciseAnswer, ExerciseResult } from "./model";
export type GradeFailure = "unanswered" | "typeMismatch" | "invalidAnswer";
export type GradeResult =
  | { readonly ok: true; readonly result: ExerciseResult }
  | { readonly ok: false; readonly reason: GradeFailure };
export const getAnswerIds = (answer: ExerciseAnswer): readonly string[] => {
  switch (answer.type) {
    case "singleChoice":
      return [answer.optionId];
    case "multipleChoice":
      return answer.optionIds;
    case "ordering":
      return answer.orderedIds;
    case "targetSelection":
      return answer.targetIds;
  }
};
export const getCandidateIds = (exercise: Exercise): readonly string[] =>
  exercise.type === "targetSelection"
    ? exercise.targetIds
    : exercise.type === "ordering"
      ? exercise.items.map((item) => item.id)
      : exercise.options.map((item) => item.id);
/** 校验结构后再评分；集合题忽略顺序，排序题严格比较顺序。 */
export const gradeExercise = (
  exercise: Exercise,
  answer: ExerciseAnswer | null,
  submittedAt: string,
): GradeResult => {
  if (!answer) return { ok: false, reason: "unanswered" };
  if (exercise.type !== answer.type)
    return { ok: false, reason: "typeMismatch" };
  const ids = getAnswerIds(answer);
  if (!ids.length || ids.every((id) => !id))
    return { ok: false, reason: "unanswered" };
  const candidates = getCandidateIds(exercise);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !candidates.includes(id)) ||
    (exercise.type === "ordering" && ids.length !== candidates.length)
  )
    return { ok: false, reason: "invalidAnswer" };
  const expected = getAnswerIds(exercise.answer);
  const isCorrect =
    ids.length === expected.length &&
    (exercise.type === "ordering"
      ? ids.every((id, index) => id === expected[index])
      : ids.every((id) => expected.includes(id)));
  return {
    ok: true,
    result: {
      exerciseId: exercise.id,
      answer: structuredClone(answer),
      isCorrect,
      submittedAt,
    },
  };
};
export const formatExerciseAnswer = (
  exercise: Exercise,
  answer: ExerciseAnswer,
): string => {
  const labels = new Map(
    (exercise.type === "ordering"
      ? exercise.items
      : exercise.type === "targetSelection"
        ? exercise.targetIds.map((id) => ({
            id,
            label:
              id.replace("string-", "第 ").replace("-fret-", " 弦 · ") + " 品",
          }))
        : exercise.options
    ).map((option) => [option.id, option.label]),
  );
  return getAnswerIds(answer)
    .map((id) => labels.get(id) ?? "已失效选项")
    .join(answer.type === "ordering" ? " → " : "、");
};
