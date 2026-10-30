import type { GuitarAdvancedSettings } from "../../lib/guitar-advanced/model";
/** 课程内容保持 v2；进度 schema 独立演进到 v4。 */
export const GUITAR_ADVANCED_SETTINGS = {
  contentVersion: "v2",
  progressSchemaVersion: 4,
  progressStorageKey: "lxm-guitar-advanced-progress:v4",
  v3ProgressStorageKey: "lxm-guitar-advanced-progress:v3",
  v2ProgressStorageKey: "lxm-guitar-advanced-progress:v2",
  legacyProgressStorageKey: "lxm-guitar-advanced-progress:v1",
} as const satisfies GuitarAdvancedSettings;
