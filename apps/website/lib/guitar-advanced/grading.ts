import type { Exercise, ExerciseResult } from "./model";

/** 单选题评分只接受题目自身的选项 ID，避免未知输入被误判为正确。 */
export const gradeSingleChoice = (
  exercise: Exercise,
  selectedOptionId: string | null,
  submittedAt: string,
): ExerciseResult => ({
  exerciseId: exercise.id,
  selectedOptionId:
    selectedOptionId &&
    exercise.options.some((option) => option.id === selectedOptionId)
      ? selectedOptionId
      : null,
  isCorrect: selectedOptionId === exercise.answer.optionId,
  submittedAt,
});
