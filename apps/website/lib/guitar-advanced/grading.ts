import type { Exercise, ExerciseAnswer, ExerciseResult } from "./model";
export type GradeFailure = "unanswered" | "typeMismatch" | "invalidAnswer";
export type GradeResult =
  | { readonly ok: true; readonly result: ExerciseResult }
  | { readonly ok: false; readonly reason: GradeFailure };
/** 提取答案 ID，保留输入顺序；排序题依赖该顺序判分。 */
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
/** 统一获取题目允许的候选 ID，用于排除失效或越界答案。 */
export const getCandidateIds = (exercise: Exercise): readonly string[] =>
  exercise.type === "targetSelection"
    ? exercise.targetIds
    : exercise.type === "ordering"
      ? exercise.items.map((item) => item.id)
      : exercise.options.map((item) => item.id);
/**
 * 练习与考试共用的纯判分入口：先校验答案类型、重复 ID 和候选范围，再判断正误。
 * 集合题忽略顺序，排序题必须包含全部候选且顺序一致；合法错答仍返回 ok。
 * 返回结果深拷贝答案，避免后续界面编辑反向修改已提交记录。
 */
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
/** 将答案映射为可读标签；失效 ID 显式占位，排序题使用箭头保留顺序语义。 */
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
