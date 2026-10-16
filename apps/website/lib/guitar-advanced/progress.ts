import type {
  Exercise,
  ExerciseResult,
  GuitarModule,
  GuitarProgressV1,
  LastVisitedContent,
  Lesson,
} from "./model";

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** 返回新状态，避免页面动作或测试意外修改默认 JSON 数据。 */
export const markLessonComplete = (
  progress: GuitarProgressV1,
  lessonId: string,
  updatedAt: string,
): GuitarProgressV1 => ({
  ...progress,
  completedLessonIds: unique([...progress.completedLessonIds, lessonId]),
  updatedAt,
});

export const addExerciseResult = (
  progress: GuitarProgressV1,
  result: ExerciseResult,
  updatedAt: string,
): GuitarProgressV1 => ({
  ...progress,
  completedExerciseIds: unique([
    ...progress.completedExerciseIds,
    result.exerciseId,
  ]),
  exerciseResults: {
    ...progress.exerciseResults,
    [result.exerciseId]: result,
  },
  updatedAt,
});

export const setLastVisited = (
  progress: GuitarProgressV1,
  lastVisited: LastVisitedContent,
  updatedAt: string,
): GuitarProgressV1 => ({ ...progress, lastVisited, updatedAt });

export const isLessonComplete = (
  progress: GuitarProgressV1,
  lessonId: string,
): boolean => progress.completedLessonIds.includes(lessonId);

export const isExerciseComplete = (
  progress: GuitarProgressV1,
  exerciseId: string,
): boolean => progress.completedExerciseIds.includes(exerciseId);

export const getModuleProgress = (
  module: GuitarModule,
  progress: GuitarProgressV1,
): { completed: number; total: number; ratio: number } => {
  const total = module.lessonIds.length + module.exerciseIds.length;
  const completed =
    module.lessonIds.filter((id) => isLessonComplete(progress, id)).length +
    module.exerciseIds.filter((id) => isExerciseComplete(progress, id)).length;
  return { completed, total, ratio: total === 0 ? 0 : completed / total };
};

export const getOverallProgress = (
  modules: readonly GuitarModule[],
  progress: GuitarProgressV1,
): { completed: number; total: number; ratio: number } => {
  const available = modules.filter(
    (module) => module.availability === "available",
  );
  const completed = available.reduce(
    (sum, module) => sum + getModuleProgress(module, progress).completed,
    0,
  );
  const total = available.reduce(
    (sum, module) => sum + getModuleProgress(module, progress).total,
    0,
  );
  return { completed, total, ratio: total === 0 ? 0 : completed / total };
};

export const getContinueTarget = (
  modules: readonly GuitarModule[],
  lessons: readonly Lesson[],
  exercises: readonly Exercise[],
  progress: GuitarProgressV1,
): LastVisitedContent | null => {
  const last = progress.lastVisited;
  if (last) {
    const lastLesson = lessons.find((lesson) => lesson.id === last.id);
    const lastExercise = exercises.find((exercise) => exercise.id === last.id);
    if (lastLesson && !isLessonComplete(progress, lastLesson.id)) return last;
    if (lastExercise && !isExerciseComplete(progress, lastExercise.id))
      return last;
  }
  for (const moduleItem of modules.filter(
    (item) => item.availability === "available",
  )) {
    const lesson = lessons.find(
      (item) =>
        item.moduleId === moduleItem.id && !isLessonComplete(progress, item.id),
    );
    if (lesson) return { kind: "lesson", id: lesson.id };
    const exercise = exercises.find(
      (item) =>
        item.moduleId === moduleItem.id &&
        !isExerciseComplete(progress, item.id),
    );
    if (exercise) return { kind: "exercise", id: exercise.id };
  }
  return null;
};
