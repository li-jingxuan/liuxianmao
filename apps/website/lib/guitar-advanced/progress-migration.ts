import { findTarget } from "./catalog";
import { gradeExercise } from "./grading";
import { addExerciseResult } from "./progress";
import type {
  GuitarAdvancedData,
  GuitarProgressV1,
  GuitarProgressV2,
  GuitarProgressV3,
  GuitarProgressV4,
} from "./model";
const unique = (ids: readonly string[]) => [...new Set(ids)];
/**
 * 将已通过存储结构校验的学习记录对齐当前目录，去除失效 ID 并重新判定有效答案。
 * 完成与曾错事实独立保留，考试字段随展开原样传递；不在这里重算历史试卷。
 * 目录失效与存储损坏不同，后者由读取层保护原文，不能靠规范化掩盖。
 */
export const normalizeProgress = <
  T extends GuitarProgressV2 | GuitarProgressV3 | GuitarProgressV4,
>(
  p: T,
  data: GuitarAdvancedData,
): T => {
  const exerciseIds = new Set(data.exercises.map((e) => e.id));
  const wrong = unique(p.wrongExerciseIds.filter((id) => exerciseIds.has(id)));
  let next = {
    ...p,
    completedLessonIds: unique(
      p.completedLessonIds.filter((id) =>
        data.lessons.some((l) => l.id === id),
      ),
    ),
    completedExerciseIds: unique(
      p.completedExerciseIds.filter((id) => exerciseIds.has(id)),
    ),
    exerciseResults: {},
    wrongExerciseIds: wrong,
    reviewedExerciseIds: unique(
      p.reviewedExerciseIds.filter((id) => wrong.includes(id)),
    ),
    lastVisited:
      p.lastVisited && findTarget(data, p.lastVisited)
        ? { kind: p.lastVisited.kind, id: p.lastVisited.id }
        : null,
  };
  for (const [id, result] of Object.entries(p.exerciseResults)) {
    const exercise = data.exercises.find((e) => e.id === id);
    if (!exercise || result.exerciseId !== id) continue;
    const graded = gradeExercise(exercise, result.answer, result.submittedAt);
    if (graded.ok)
      next = addExerciseResult(
        next,
        graded.result,
        p.updatedAt ?? result.submittedAt,
      );
  }
  return { ...next, updatedAt: p.updatedAt } as T;
};
/** v1 单选语义和稳定 ID 保留，旧空答案只保留完成/曾错事实。 */
export const migrateProgressV1ToV2 = (
  p: GuitarProgressV1,
  data: GuitarAdvancedData,
): GuitarProgressV2 => {
  const results: GuitarProgressV2["exerciseResults"] = Object.fromEntries(
    Object.entries(p.exerciseResults)
      .filter(([, r]) => r.selectedOptionId !== null)
      .map(([id, r]) => [
        id,
        {
          exerciseId: r.exerciseId,
          answer: {
            type: "singleChoice" as const,
            optionId: r.selectedOptionId!,
          },
          isCorrect: r.isCorrect,
          submittedAt: r.submittedAt,
        },
      ]),
  );
  return normalizeProgress(
    {
      schemaVersion: 2,
      completedLessonIds: p.completedLessonIds,
      completedExerciseIds: p.completedExerciseIds,
      exerciseResults: results,
      wrongExerciseIds: Object.entries(p.exerciseResults)
        .filter(([id, r]) => id === r.exerciseId && !r.isCorrect)
        .map(([id]) => id),
      reviewedExerciseIds: [],
      lastVisited: p.lastVisited,
      updatedAt: p.updatedAt,
    },
    data,
  );
};

/** v2 学习进度字段保持原样；新增空考试历史，不回写旧版本 key。 */
export const migrateProgressV2ToV3 = (
  p: GuitarProgressV2,
): GuitarProgressV3 => ({
  ...p,
  schemaVersion: 3,
  examAttempts: [],
  activeExamAttemptId: null,
});
/** v3 学习与考试记录原样保留，只添加 R6 专属错题复习索引。 */
export const migrateProgressV3ToV4 = (
  p: GuitarProgressV3,
): GuitarProgressV4 => ({
  ...p,
  schemaVersion: 4,
  examQuestionReviews: {},
});
/** v1 经既有 v2 规则规范化后再升级，确保旧记录语义不变。 */
export const migrateProgressV1ToV3 = (
  p: GuitarProgressV1,
  data: GuitarAdvancedData,
): GuitarProgressV3 =>
  migrateProgressV2ToV3(migrateProgressV1ToV2(p, data));
/** 顺序补齐考试历史与复习索引；调用方负责先按当前目录规范化 v2 学习字段。 */
export const migrateProgressV2ToV4 = (
  p: GuitarProgressV2,
): GuitarProgressV4 => migrateProgressV3ToV4(migrateProgressV2ToV3(p));
/** 复用逐版本迁移链，先转换旧单选记录，再补齐 v4 新字段。 */
export const migrateProgressV1ToV4 = (
  p: GuitarProgressV1,
  data: GuitarAdvancedData,
): GuitarProgressV4 => migrateProgressV3ToV4(migrateProgressV1ToV3(p, data));
