import type { GuitarAdvancedSettings } from "../../lib/guitar-advanced/model";

/** 版本和存储配置集中维护，避免 key 在页面、store 和测试中重复硬编码。 */
export const GUITAR_ADVANCED_SETTINGS = {
  contentVersion: "v1",
  progressSchemaVersion: 1,
  progressStorageKey: "lxm-guitar-advanced-progress:v1",
} as const satisfies GuitarAdvancedSettings;
