import type { GuitarProgressV1 } from "./model";

export interface ProgressStorage {
  read: () => string | null;
  write: (value: string) => void;
  remove: () => void;
}

export interface ProgressReadResult {
  progress: GuitarProgressV1 | null;
  error: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isValidProgress = (value: unknown): value is GuitarProgressV1 => {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!isStringArray(value.completedLessonIds)) return false;
  if (!isStringArray(value.completedExerciseIds)) return false;
  if (value.lastVisited !== null) {
    if (!isRecord(value.lastVisited)) return false;
    if (
      !["lesson", "exercise"].includes(String(value.lastVisited.kind)) ||
      typeof value.lastVisited.id !== "string"
    )
      return false;
  }
  if (value.updatedAt !== null && typeof value.updatedAt !== "string")
    return false;
  if (!isRecord(value.exerciseResults)) return false;
  return Object.values(value.exerciseResults).every((result) => {
    if (!isRecord(result)) return false;
    return (
      typeof result.exerciseId === "string" &&
      (result.selectedOptionId === null ||
        typeof result.selectedOptionId === "string") &&
      typeof result.isCorrect === "boolean" &&
      typeof result.submittedAt === "string"
    );
  });
};

/** 默认状态必须复制，避免 store 修改 data 文件导出的共享对象。 */
export const cloneProgress = (progress: GuitarProgressV1): GuitarProgressV1 =>
  JSON.parse(JSON.stringify(progress)) as GuitarProgressV1;

export const parseProgress = (
  raw: string | null,
  fallback: GuitarProgressV1,
): ProgressReadResult => {
  if (!raw) return { progress: cloneProgress(fallback), error: null };
  try {
    const value: unknown = JSON.parse(raw);
    return isValidProgress(value)
      ? { progress: value, error: null }
      : {
          progress: cloneProgress(fallback),
          error: "本地学习记录版本或字段无效",
        };
  } catch {
    return { progress: cloneProgress(fallback), error: "本地学习记录无法读取" };
  }
};

export const createBrowserProgressStorage = (key: string): ProgressStorage => ({
  read: () => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  },
  write: (value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  remove: () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
});
