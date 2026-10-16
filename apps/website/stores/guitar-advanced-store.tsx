import { useStore } from "zustand";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  GUITAR_ADVANCED_DATA,
  GUITAR_ADVANCED_INITIAL_PROGRESS,
  GUITAR_ADVANCED_SETTINGS,
} from "../data/guitar-advanced";
import { gradeSingleChoice } from "../lib/guitar-advanced/grading";
import {
  addExerciseResult,
  markLessonComplete,
  setLastVisited,
} from "../lib/guitar-advanced/progress";
import {
  cloneProgress,
  createBrowserProgressStorage,
  parseProgress,
  type ProgressStorage,
} from "../lib/guitar-advanced/storage";
import type {
  ExerciseResult,
  GuitarAdvancedData,
  GuitarProgressV1,
  LastVisitedContent,
} from "../lib/guitar-advanced/model";

export interface GuitarProgressStore {
  progress: GuitarProgressV1;
  hydrated: boolean;
  storageError: string | null;
  markLessonComplete: (lessonId: string) => void;
  submitExercise: (exerciseId: string, selectedOptionId: string | null) => void;
  resetExerciseAttempt: (exerciseId: string) => void;
  setLastVisited: (content: LastVisitedContent) => void;
  clearProgress: () => void;
  hydrate: () => void;
}

interface StoreOptions {
  catalog: GuitarAdvancedData;
  initialProgress: GuitarProgressV1;
  storage: ProgressStorage;
  now: () => string;
}

const persist = (
  progress: GuitarProgressV1,
  storage: ProgressStorage,
): string | null => {
  try {
    storage.write(JSON.stringify(progress));
    return null;
  } catch {
    return "学习记录保存失败，当前页面仍可继续使用";
  }
};

/** store 工厂注入时间、数据和存储适配器，测试不依赖真实浏览器环境。 */
export const createGuitarProgressStore = (
  options: StoreOptions,
): StoreApi<GuitarProgressStore> =>
  createStore<GuitarProgressStore>((set, get) => {
    let hydrationStarted = false;
    let storageWritable = true;

    // 页面子组件的访问记录 effect 可能先于布局 effect；任何写动作先读旧记录，防止空状态覆盖已有进度。
    const hydrateOnce = () => {
      if (hydrationStarted) return;
      hydrationStarted = true;
      try {
        const result = parseProgress(
          options.storage.read(),
          options.initialProgress,
        );
        storageWritable = !result.error;
        set({
          progress: result.progress ?? cloneProgress(options.initialProgress),
          hydrated: true,
          storageError: result.error,
        });
      } catch {
        storageWritable = false;
        set({
          progress: cloneProgress(options.initialProgress),
          hydrated: true,
          storageError: "浏览器不允许读取本地学习记录",
        });
      }
    };

    const persistProgress = (progress: GuitarProgressV1): string | null =>
      storageWritable ? persist(progress, options.storage) : get().storageError;

    return {
      progress: cloneProgress(options.initialProgress),
      hydrated: false,
      storageError: null,
      markLessonComplete: (lessonId) => {
        hydrateOnce();
        const next = markLessonComplete(
          get().progress,
          lessonId,
          options.now(),
        );
        set({ progress: next, storageError: persistProgress(next) });
      },
      submitExercise: (exerciseId, selectedOptionId) => {
        hydrateOnce();
        const exercise = options.catalog.exercises.find(
          (item) => item.id === exerciseId,
        );
        if (!exercise) {
          set({ storageError: "练习内容不存在，无法提交答案" });
          return;
        }
        const result = gradeSingleChoice(
          exercise,
          selectedOptionId,
          options.now(),
        );
        const next = addExerciseResult(get().progress, result, options.now());
        set({ progress: next, storageError: persistProgress(next) });
      },
      resetExerciseAttempt: (exerciseId) => {
        hydrateOnce();
        const current = get().progress;
        if (!current.exerciseResults[exerciseId]) return;
        const { [exerciseId]: _removed, ...exerciseResults } =
          current.exerciseResults;
        const next = {
          ...current,
          exerciseResults,
          updatedAt: options.now(),
        };
        set({ progress: next, storageError: persistProgress(next) });
      },
      setLastVisited: (content) => {
        hydrateOnce();
        const next = setLastVisited(get().progress, content, options.now());
        set({ progress: next, storageError: persistProgress(next) });
      },
      clearProgress: () => {
        hydrateOnce();
        try {
          options.storage.remove();
          storageWritable = true;
          set({
            progress: cloneProgress(options.initialProgress),
            storageError: null,
          });
        } catch {
          set({ storageError: "本地学习记录清除失败，请检查浏览器权限" });
        }
      },
      hydrate: hydrateOnce,
    };
  });

const GuitarAdvancedStoreContext =
  createContext<StoreApi<GuitarProgressStore> | null>(null);

export const GuitarAdvancedStoreProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [store] = useState(() =>
    createGuitarProgressStore({
      catalog: GUITAR_ADVANCED_DATA,
      initialProgress: GUITAR_ADVANCED_INITIAL_PROGRESS,
      storage: createBrowserProgressStorage(
        GUITAR_ADVANCED_SETTINGS.progressStorageKey,
      ),
      now: () => new Date().toISOString(),
    }),
  );
  return (
    <GuitarAdvancedStoreContext.Provider value={store}>
      {children}
    </GuitarAdvancedStoreContext.Provider>
  );
};

export const useGuitarAdvancedStore = <T,>(
  selector: (state: GuitarProgressStore) => T,
): T => {
  const store = useContext(GuitarAdvancedStoreContext);
  if (!store) throw new Error("GuitarAdvancedStoreProvider is missing");
  return useStore(store, selector);
};

export type { ExerciseResult };
