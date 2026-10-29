export * from "./layout";
export * from "./layout/layout-types";
/** 渲染层共用品位文字与 marker 尺寸，避免出现核心不知道的视觉外延。 */
export {
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
} from "./layout/layout-constants";
export * from "./editing/navigation";
export * from "./editing/tab-cell-selection";
export * from "./editing/technique-selection";
export * from "./core/constants";
export * from "./core/id-factory";
export * from "./core/commands";
export * from "./core/loader";
export * from "./core/schema";
export * from "./core/semantic-validation";
export * from "./core/time-signature-change";
export * from "./core/technique-rules";
export * from "./core/types";

/** 具名规范谱例供页面和验收测试共用。 */
export { default as EXAMPLE_MVP_4_DOCUMENT } from "../example/example-mvp4.json";
export { default as EXAMPLE_MVP_5_DOCUMENT } from "../example/example-mvp5.json";

export * as EXAMPLE from "../example";

export * from "./core/tuplet";
export * from "./core/measure-timeline";

export { default as EXAMPLE_MVP_5_1_DOCUMENT } from "../example/example-mvp5.1.json";

export * from "./editing/tuplet-selection";

export * from "./core/music-text";
export * from "./core/chord-diagram";

export * from "./core/chord-presets";
export { default as EXAMPLE_MVP_6_DOCUMENT } from "../example/example-mvp6.json";

export * from "./core/lyric-sequence";

export { default as EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT } from "../example/example-technique-rhythm";

export * from "./core/command-effects";

export { default as EXAMPLE_MUTED_NOTE_DOCUMENT } from "../example/example-muted-note";

export * from "./core/tuning";

export * from "./core/numbered-notation";

export * from "./core/beat-clipboard";
export * from "./core/beat-structure";

export {
  EXAMPLE_MVP7C_DOCUMENT,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
  createMvp7cExample,
} from "../example/example-mvp7c";
export { createQualityScore } from "../example/quality-score";
export { default as EXAMPLE_MVP_7_2_DOCUMENT } from "../example/example-mvp7.2";

export * from "./core/numbered-rhythm";
export * from "./core/numbered-timeline";
export * from "./core/numbered-commands";
export * from "./core/numbered-marks";
export * from "./core/numbered-clipboard";
export { getMeasureCapacityTicks, calculateRhythmTicks } from "./core/rhythm";
export * from "./core/numbered-input-ranges";
