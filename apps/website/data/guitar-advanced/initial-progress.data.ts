import type { GuitarProgressV1 } from "../../lib/guitar-advanced/model";

/** 默认进度保持为纯 JSON；运行时 store 必须复制后再写入。 */
export const GUITAR_ADVANCED_INITIAL_PROGRESS = {
  schemaVersion: 1,
  completedLessonIds: [],
  completedExerciseIds: [],
  exerciseResults: {},
  lastVisited: null,
  updatedAt: null,
} as const satisfies GuitarProgressV1;
