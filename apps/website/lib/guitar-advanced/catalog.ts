import type {
  Exercise,
  GuitarAdvancedData,
  GuitarModule,
  Lesson,
} from "./model";

export const findModule = (
  data: GuitarAdvancedData,
  moduleId: string,
): GuitarModule | null =>
  data.modules.find((item) => item.id === moduleId) ?? null;

export const findLesson = (
  data: GuitarAdvancedData,
  lessonId: string,
): Lesson | null => data.lessons.find((item) => item.id === lessonId) ?? null;

export const findExercise = (
  data: GuitarAdvancedData,
  exerciseId: string,
): Exercise | null =>
  data.exercises.find((item) => item.id === exerciseId) ?? null;

/** 内容校验集中在一个纯函数中，页面和测试都通过同一 seam 检查引用关系。 */
export const validateGuitarAdvancedData = (
  data: GuitarAdvancedData,
): string[] => {
  const errors: string[] = [];
  const moduleIds = new Set<string>();
  const lessonIds = new Set<string>();
  const exerciseIds = new Set<string>();

  for (const moduleItem of data.modules) {
    if (moduleIds.has(moduleItem.id))
      errors.push(`模块 ID 重复：${moduleItem.id}`);
    moduleIds.add(moduleItem.id);
  }
  for (const lesson of data.lessons) {
    if (lessonIds.has(lesson.id)) errors.push(`理论 ID 重复：${lesson.id}`);
    lessonIds.add(lesson.id);
    if (!moduleIds.has(lesson.moduleId))
      errors.push(`理论引用不存在的模块：${lesson.id}`);
    for (const exerciseId of lesson.exerciseIds) {
      if (
        !exerciseIds.has(exerciseId) &&
        !data.exercises.some((item) => item.id === exerciseId)
      )
        errors.push(`理论引用不存在的练习：${exerciseId}`);
    }
  }
  for (const exercise of data.exercises) {
    if (exerciseIds.has(exercise.id))
      errors.push(`练习 ID 重复：${exercise.id}`);
    exerciseIds.add(exercise.id);
    if (!lessonIds.has(exercise.lessonId))
      errors.push(`练习引用不存在的理论：${exercise.id}`);
    if (!moduleIds.has(exercise.moduleId))
      errors.push(`练习引用不存在的模块：${exercise.id}`);
    if (
      !exercise.options.some((option) => option.id === exercise.answer.optionId)
    )
      errors.push(`练习答案不在选项中：${exercise.id}`);
  }
  return errors;
};
