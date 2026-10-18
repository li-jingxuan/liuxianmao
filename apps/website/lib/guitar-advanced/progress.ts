import { findTarget, getLearningSequence } from "./catalog";
import type {
  ExerciseResult,
  GuitarAdvancedData,
  GuitarModule,
  GuitarProgressV2,
  GuitarProgressV3,
  GuitarProgressV4,
  LastVisitedContent,
} from "./model";
const unique = (ids: readonly string[]) => [...new Set(ids)];
type LearningProgress = GuitarProgressV2 | GuitarProgressV3 | GuitarProgressV4;
export const markLessonComplete = <T extends LearningProgress>(
  p: T,
  id: string,
  time: string,
): T =>
  p.completedLessonIds.includes(id)
    ? p
    : {
        ...p,
        completedLessonIds: unique([...p.completedLessonIds, id]),
        updatedAt: time,
      } as T;
/** 完成与正确性分离；错题历史保留，再答对只标记已复习。 */
export const addExerciseResult = <T extends LearningProgress>(
  p: T,
  result: ExerciseResult,
  time: string,
): T => {
  const wrong = result.isCorrect
    ? p.wrongExerciseIds
    : unique([...p.wrongExerciseIds, result.exerciseId]);
  const reviewed = !result.isCorrect
    ? p.reviewedExerciseIds.filter((id) => id !== result.exerciseId)
    : wrong.includes(result.exerciseId)
      ? unique([...p.reviewedExerciseIds, result.exerciseId])
      : p.reviewedExerciseIds;
  return {
    ...p,
    completedExerciseIds: unique([
      ...p.completedExerciseIds,
      result.exerciseId,
    ]),
    exerciseResults: { ...p.exerciseResults, [result.exerciseId]: result },
    wrongExerciseIds: wrong,
    reviewedExerciseIds: reviewed,
    updatedAt: time,
  } as T;
};
export const setLastVisited = <T extends LearningProgress>(
  p: T,
  target: LastVisitedContent,
  time: string,
): T => ({
  ...p,
  lastVisited: { kind: target.kind, id: target.id },
  updatedAt: time,
}) as T;
export const isLessonComplete = (p: Pick<LearningProgress, "completedLessonIds">, id: string) =>
  p.completedLessonIds.includes(id);
export const isExerciseComplete = (p: Pick<LearningProgress, "completedExerciseIds">, id: string) =>
  p.completedExerciseIds.includes(id);
export const isTargetComplete = (
  p: Pick<LearningProgress, "completedLessonIds" | "completedExerciseIds">,
  target: LastVisitedContent,
) =>
  target.kind === "lesson"
    ? isLessonComplete(p, target.id)
    : isExerciseComplete(p, target.id);
export const getModuleProgress = (
  m: GuitarModule,
  p: Pick<LearningProgress, "completedLessonIds" | "completedExerciseIds">,
) => {
  const ids = [...new Set(m.lessonIds)];
  const exercises = [...new Set(m.exerciseIds)];
  const total = ids.length + exercises.length;
  const completed =
    ids.filter((id) => isLessonComplete(p, id)).length +
    exercises.filter((id) => isExerciseComplete(p, id)).length;
  return { completed, total, ratio: total ? completed / total : 0 };
};
export const getOverallProgress = (
  modules: readonly GuitarModule[],
  p: Pick<LearningProgress, "completedLessonIds" | "completedExerciseIds">,
) => {
  const all = modules.filter((m) => m.availability === "available");
  const total =
    new Set(all.flatMap((m) => m.lessonIds)).size +
    new Set(all.flatMap((m) => m.exerciseIds)).size;
  const completed =
    new Set(
      all.flatMap((m) => m.lessonIds).filter((id) => isLessonComplete(p, id)),
    ).size +
    new Set(
      all
        .flatMap((m) => m.exerciseIds)
        .filter((id) => isExerciseComplete(p, id)),
    ).size;
  return { completed, total, ratio: total ? completed / total : 0 };
};
export const getContinueTarget = (
  data: GuitarAdvancedData,
  p: Pick<LearningProgress, "completedLessonIds" | "completedExerciseIds" | "lastVisited">,
  moduleId?: string,
) => {
  const last = p.lastVisited ? findTarget(data, p.lastVisited) : null;
  if (
    last &&
    (!moduleId || last.moduleId === moduleId) &&
    !isTargetComplete(p, last)
  )
    return last;
  return (
    getLearningSequence(data).find(
      (t) => (!moduleId || t.moduleId === moduleId) && !isTargetComplete(p, t),
    ) ?? null
  );
};
export const getNextTarget = (
  data: GuitarAdvancedData,
  p: Pick<LearningProgress, "completedLessonIds" | "completedExerciseIds" | "lastVisited">,
  current: LastVisitedContent,
) => {
  const sequence = getLearningSequence(data);
  const i = sequence.findIndex(
    (t) => t.id === current.id && t.kind === current.kind,
  );
  return (
    sequence.slice(i + 1).find((t) => !isTargetComplete(p, t)) ??
    getContinueTarget(data, p)
  );
};
