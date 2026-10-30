import type { GuitarProgressV4 } from "../../lib/guitar-advanced/model";
export const GUITAR_ADVANCED_INITIAL_PROGRESS = {
  schemaVersion: 4,
  completedLessonIds: [],
  completedExerciseIds: [],
  exerciseResults: {},
  wrongExerciseIds: [],
  reviewedExerciseIds: [],
  lastVisited: null,
  updatedAt: null,
  examAttempts: [],
  activeExamAttemptId: null,
  examQuestionReviews: {},
} as const satisfies GuitarProgressV4;
