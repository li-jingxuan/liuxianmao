"use client";
import { useStore } from "zustand";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  GUITAR_ADVANCED_EXAM,
  GUITAR_ADVANCED_INITIAL_PROGRESS,
  GUITAR_ADVANCED_SETTINGS,
} from "../data/guitar-advanced";
import { findExercise, findLesson, findTarget } from "../lib/guitar-advanced/catalog";
import { gradeExercise, type GradeFailure } from "../lib/guitar-advanced/grading";
import {
  createExamAttempt,
  gradeExamAttempt,
  getExamReadiness,
  setExamAnswer as updateExamAnswer,
  setExamQuestionIndex as updateExamQuestionIndex,
  submitExamAttempt,
  validateExamContent,
  type ExamActionFailure,
} from "../lib/guitar-advanced/exam";
import {
  addExerciseResult,
  markLessonComplete,
  setLastVisited,
} from "../lib/guitar-advanced/progress";
import {
  migrateProgressV1ToV4,
  migrateProgressV2ToV4,
  migrateProgressV3ToV4,
  normalizeProgress,
} from "../lib/guitar-advanced/progress-migration";
import {
  cloneProgress,
  createBrowserProgressStorage,
  parseProgress,
  type ProgressStorage,
} from "../lib/guitar-advanced/storage";
import type {
  ExamAttempt,
  ExerciseAnswer,
  GuitarAdvancedData,
  GuitarAdvancedExam,
  GuitarProgress,
  GuitarProgressV1,
  GuitarProgressV2,
  GuitarProgressV3,
  GuitarProgressV4,
  LastVisitedContent,
} from "../lib/guitar-advanced/model";

export type ActionResult =
  | { readonly ok: true; readonly persisted: boolean }
  | {
      readonly ok: false;
      readonly reason:
        | GradeFailure
        | ExamActionFailure
        | "notFound"
        | "alreadySubmitted"
        | "readProtected"
        | "storageFailure";
    };
export type ExamAttemptResult =
  | { readonly ok: true; readonly persisted: boolean; readonly attempt: ExamAttempt }
  | { readonly ok: false; readonly reason: ActionFailure };
type ActionFailure =
  | GradeFailure
  | ExamActionFailure
  | "notFound"
  | "alreadySubmitted"
  | "readProtected"
  | "storageFailure";
export interface StorageIssue {
  kind: "readProtected" | "writeFailed" | "deleteFailed";
  message: string;
}
export interface GuitarProgressStore {
  progress: GuitarProgressV4;
  hydrated: boolean;
  storageIssue: StorageIssue | null;
  notification: string | null;
  markLessonComplete: (id: string) => ActionResult;
  submitExercise: (id: string, answer: ExerciseAnswer | null) => ActionResult;
  resetExerciseAttempt: (id: string) => ActionResult;
  setLastVisited: (content: LastVisitedContent) => void;
  startExam: () => ExamAttemptResult;
  setExamAnswer: (attemptId: string, questionId: string, answer: ExerciseAnswer | null) => ExamAttemptResult;
  setExamQuestionIndex: (attemptId: string, index: number) => ExamAttemptResult;
  submitExam: (attemptId: string) => ExamAttemptResult;
  markExamQuestionReviewed: (attemptId: string, questionId: string) => ActionResult;
  clearProgress: () => ActionResult;
  retryPersist: () => ActionResult;
  dismissNotification: () => void;
  hydrate: () => void;
}
interface StoreOptions {
  catalog: GuitarAdvancedData;
  exam: GuitarAdvancedExam;
  initialProgress: GuitarProgressV4;
  storage: ProgressStorage;
  now: () => string;
  createId: () => string;
}
const unavailable = (reason: ActionFailure): ExamAttemptResult => ({ ok: false, reason });

/** 独立进度 store：所有用户动作先恢复，再在同一 v4 快照上写入。 */
export const createGuitarProgressStore = (
  options: StoreOptions,
): StoreApi<GuitarProgressStore> =>
  createStore<GuitarProgressStore>((set, get) => {
    let started = false;
    let writable = true;
    const currentKey = GUITAR_ADVANCED_SETTINGS.progressStorageKey;
    const v3Key = GUITAR_ADVANCED_SETTINGS.v3ProgressStorageKey;
    const v2Key = GUITAR_ADVANCED_SETTINGS.v2ProgressStorageKey;
    const v1Key = GUITAR_ADVANCED_SETTINGS.legacyProgressStorageKey;

    const persist = (progress: GuitarProgressV4): boolean => {
      if (!writable) return false;
      try {
        options.storage.write(currentKey, JSON.stringify(progress));
        set({ storageIssue: null });
        return true;
      } catch {
        set({
          storageIssue: {
            kind: "writeFailed",
            message: "考试或学习记录保存失败，当前操作仍保留在本页；请重试保存后再离开。",
          },
        });
        return false;
      }
    };
    const commit = (progress: GuitarProgressV4): boolean => {
      set({ progress });
      return persist(progress);
    };
    const protect = (message: string) => {
      writable = false;
      set({
        hydrated: true,
        storageIssue: {
          kind: "readProtected",
          message: `${message}。已有记录暂未读取，以下仅为本次临时学习；刷新会丢失本次临时操作。`,
        },
      });
    };
    const expectVersion = <T extends GuitarProgress>(
      raw: string,
      version: 1 | 2 | 3 | 4,
      key: string,
    ): T => {
      const parsed = parseProgress(raw);
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.progress.schemaVersion !== version)
        throw new Error(`记录版本与存储位置 ${key} 不一致`);
      return parsed.progress as T;
    };
    const hydrate = () => {
      if (started) return;
      started = true;
      try {
        const v4Raw = options.storage.read(currentKey);
        if (v4Raw !== null) {
          const progress = expectVersion<GuitarProgressV4>(v4Raw, 4, currentKey);
          const learning = normalizeProgress(progress, options.catalog);
          const restored = {
            ...learning,
            examAttempts: progress.examAttempts,
            activeExamAttemptId: progress.activeExamAttemptId,
            examQuestionReviews: progress.examQuestionReviews,
          };
          const changed = JSON.stringify(restored) !== JSON.stringify(progress);
          set({ progress: restored, hydrated: true, notification: changed ? "部分学习记录已按当前课程整理，有效记录已保留。" : null });
          if (changed) persist(restored);
          return;
        }
        const v3Raw = options.storage.read(v3Key);
        if (v3Raw !== null) {
          const saved = expectVersion<GuitarProgressV3>(v3Raw, 3, v3Key);
          const migrated = migrateProgressV3ToV4(normalizeProgress(saved, options.catalog));
          set({ progress: migrated, hydrated: true, notification: "学习进度已升级，考试与学习记录已保留。" });
          persist(migrated);
          return;
        }
        const v2Raw = options.storage.read(v2Key);
        if (v2Raw !== null) {
          const saved = expectVersion<GuitarProgressV2>(v2Raw, 2, v2Key);
          const migrated = migrateProgressV2ToV4(normalizeProgress(saved, options.catalog));
          set({ progress: migrated, hydrated: true, notification: "考试功能已开放，原有学习记录已保留。" });
          persist(migrated);
          return;
        }
        const v1Raw = options.storage.read(v1Key);
        if (v1Raw !== null) {
          const saved = expectVersion<GuitarProgressV1>(v1Raw, 1, v1Key);
          const migrated = migrateProgressV1ToV4(saved, options.catalog);
          set({ progress: migrated, hydrated: true, notification: "考试功能已开放，原有学习记录已保留。" });
          persist(migrated);
          return;
        }
        set({ hydrated: true });
      } catch (error) {
        protect(error instanceof Error ? error.message : "浏览器不允许读取学习记录");
      }
    };

    const activeDraft = (attemptId: string): ExamAttempt | null => {
      const progress = get().progress;
      if (progress.activeExamAttemptId !== attemptId) return null;
      const attempt = progress.examAttempts.find((item) => item.id === attemptId);
      return attempt?.status === "draft" ? attempt : null;
    };
    const commitAttempt = (attempt: ExamAttempt): ExamAttemptResult => {
      const progress = get().progress;
      const examAttempts = progress.examAttempts.some((item) => item.id === attempt.id)
        ? progress.examAttempts.map((item) => item.id === attempt.id ? attempt : item)
        : [...progress.examAttempts, attempt];
      return {
        ok: true,
        persisted: commit({
          ...progress,
          examAttempts,
          activeExamAttemptId: attempt.status === "draft" ? attempt.id : null,
          updatedAt: attempt.updatedAt,
        }),
        attempt,
      };
    };

    return {
      progress: cloneProgress(options.initialProgress),
      hydrated: false,
      storageIssue: null,
      notification: null,
      hydrate,
      dismissNotification: () => set({ notification: null }),
      markLessonComplete: (id) => {
        hydrate();
        if (!findLesson(options.catalog, id)) return { ok: false, reason: "notFound" };
        return { ok: true, persisted: commit(markLessonComplete(get().progress, id, options.now())) };
      },
      submitExercise: (id, answer) => {
        hydrate();
        const exercise = findExercise(options.catalog, id);
        if (!exercise) return { ok: false, reason: "notFound" };
        if (get().progress.exerciseResults[id]) return { ok: false, reason: "alreadySubmitted" };
        const time = options.now();
        const graded = gradeExercise(exercise, answer, time);
        return graded.ok
          ? { ok: true, persisted: commit(addExerciseResult(get().progress, graded.result, time)) }
          : graded;
      },
      resetExerciseAttempt: (id) => {
        hydrate();
        if (!findExercise(options.catalog, id)) return { ok: false, reason: "notFound" };
        const current = get().progress;
        if (!current.exerciseResults[id]) return { ok: true, persisted: !get().storageIssue };
        const exerciseResults = { ...current.exerciseResults };
        delete exerciseResults[id];
        return { ok: true, persisted: commit({ ...current, exerciseResults, updatedAt: options.now() }) };
      },
      setLastVisited: (content) => {
        hydrate();
        if (!findTarget(options.catalog, content)) return;
        const lastVisited = get().progress.lastVisited;
        if (lastVisited?.kind === content.kind && lastVisited.id === content.id) return;
        commit(setLastVisited(get().progress, content, options.now()));
      },
      startExam: () => {
        hydrate();
        const progress = get().progress;
        if (progress.activeExamAttemptId) {
          const active = progress.examAttempts.find((attempt) => attempt.id === progress.activeExamAttemptId && attempt.status === "draft");
          return active ? { ok: true, persisted: !get().storageIssue, attempt: active } : unavailable("invalidExam");
        }
        if (!getExamReadiness(options.catalog, progress).eligible) return unavailable("notReady");
        if (validateExamContent(options.exam, options.catalog).length > 0) return unavailable("invalidExam");
        const attemptId = options.createId();
        if (!attemptId || progress.examAttempts.some((attempt) => attempt.id === attemptId)) return unavailable("invalidExam");
        const attempt = createExamAttempt(options.exam, attemptId, options.now());
        return commitAttempt(attempt);
      },
      setExamAnswer: (attemptId, questionId, answer) => {
        hydrate();
        const attempt = activeDraft(attemptId);
        if (!attempt) return unavailable("notActive");
        let updated = attempt;
        if (answer === null) {
          const answers = { ...attempt.answers };
          delete answers[questionId];
          if (!attempt.questionSnapshot.some((question) => question.id === questionId)) return unavailable("notFound");
          updated = { ...attempt, answers, updatedAt: options.now() };
        } else {
          const result = updateExamAnswer(attempt, questionId, answer, options.now());
          if (!result.ok) return unavailable(result.reason);
          updated = result.value;
        }
        return commitAttempt(updated);
      },
      setExamQuestionIndex: (attemptId, index) => {
        hydrate();
        const attempt = activeDraft(attemptId);
        if (!attempt) return unavailable("notActive");
        const result = updateExamQuestionIndex(attempt, index, options.now());
        if (!result.ok) return unavailable(result.reason);
        return commitAttempt(result.value);
      },
      submitExam: (attemptId) => {
        hydrate();
        const progress = get().progress;
        const attempt = progress.examAttempts.find((item) => item.id === attemptId);
        if (!attempt) return unavailable("notFound");
        if (attempt.status === "submitted") return { ok: true, persisted: !get().storageIssue, attempt };
        if (progress.activeExamAttemptId !== attemptId) return unavailable("notActive");
        const result = submitExamAttempt(attempt, options.exam, options.now());
        if (!result.ok) return unavailable(result.reason);
        const submitted = result.value;
        const next: GuitarProgressV4 = {
          ...progress,
          examAttempts: progress.examAttempts.map((item) => item.id === attemptId ? submitted : item),
          activeExamAttemptId: null,
          updatedAt: submitted.updatedAt,
        };
        return { ok: true, persisted: commit(next), attempt: submitted };
      },
      markExamQuestionReviewed: (attemptId, questionId) => {
        hydrate();
        const progress = get().progress;
        const attempt = progress.examAttempts.find((item) => item.id === attemptId);
        if (!attempt) return { ok: false, reason: "notFound" };
        if (attempt.status !== "submitted") return { ok: false, reason: "notActive" };
        const graded = gradeExamAttempt(attempt, options.exam);
        if (!graded.ok) return { ok: false, reason: "invalidExam" };
        const questionGrade = graded.grade.questionGrades.find((item) => item.questionId === questionId);
        if (!questionGrade) return { ok: false, reason: "notFound" };
        if (questionGrade.isCorrect) return { ok: false, reason: "invalidAnswer" };
        const reviewKey = `${attempt.examId}:${questionId}`;
        const existing = progress.examQuestionReviews[reviewKey];
        if (existing?.attemptId === attemptId)
          return { ok: true, persisted: !get().storageIssue };
        const reviewedAt = options.now();
        return {
          ok: true,
          persisted: commit({
            ...progress,
            examQuestionReviews: {
              ...progress.examQuestionReviews,
              [reviewKey]: { attemptId, reviewedAt },
            },
            updatedAt: reviewedAt,
          }),
        };
      },
      retryPersist: () => {
        hydrate();
        return writable ? { ok: true, persisted: persist(get().progress) } : { ok: false, reason: "readProtected" };
      },
      clearProgress: () => {
        hydrate();
        try {
          options.storage.remove(v1Key);
          options.storage.remove(v2Key);
          options.storage.remove(v3Key);
          options.storage.remove(currentKey);
          writable = true;
          set({ progress: cloneProgress(options.initialProgress), storageIssue: null, notification: null });
          return { ok: true, persisted: true };
        } catch {
          set({ storageIssue: { kind: writable ? "deleteFailed" : "readProtected", message: "本地学习记录清除失败，当前进度仍保留，请检查权限后重试。" } });
          return { ok: false, reason: "storageFailure" };
        }
      },
    };
  });

const Context = createContext<StoreApi<GuitarProgressStore> | null>(null);
export const GuitarAdvancedStoreProvider = ({
  children,
  catalog,
  exam = GUITAR_ADVANCED_EXAM,
}: {
  children: ReactNode;
  catalog: GuitarAdvancedData;
  exam?: GuitarAdvancedExam;
}) => {
  const [store] = useState(() => createGuitarProgressStore({
    catalog,
    exam,
    initialProgress: GUITAR_ADVANCED_INITIAL_PROGRESS,
    storage: createBrowserProgressStorage(),
    now: () => new Date().toISOString(),
    createId: () => crypto.randomUUID(),
  }));
  return <Context.Provider value={store}>{children}</Context.Provider>;
};
export const useGuitarAdvancedStore = <T,>(selector: (state: GuitarProgressStore) => T): T => {
  const store = useContext(Context);
  if (!store) throw new Error("GuitarAdvancedStoreProvider is missing");
  return useStore(store, selector);
};
