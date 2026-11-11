export * from "./layout";
export { buildScoreScene, textPrimitive } from "./presentation/score-scene";
export { SCORE_TEXT_FONT } from "./presentation/constants";
export type { SceneStyle, ScorePrimitive, ScoreScene } from "./presentation/scene-types";
export * from "./layout/layout-types";
/** 渲染层共用品位文字与 marker 尺寸，避免出现核心不知道的视觉外延。 */
export {
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_DURATION_STEM_STROKE_WIDTH,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
} from "./layout/layout-constants";
export * from "./editing/navigation";
export * from "./editing/tab-cell-selection";
export * from "./editing/technique-selection";
export * from "./core/constants";
export * from "./core/id-factory";
export * from "./core/commands/commands";
export * from "./core/document/loader";
export * from "./core/document/schema";
export * from "./core/document/semantic-validation";
export * from "./core/rhythm/time-signature-change";
export * from "./core/techniques/technique-rules";
export * from "./core/types";

/** 具名规范谱例供页面和验收测试共用。 */
export { default as EXAMPLE_MVP_4_DOCUMENT } from "../example/example-mvp4.json";
export { default as EXAMPLE_MVP_5_DOCUMENT } from "../example/example-mvp5.json";

export * as EXAMPLE from "../example";

export * from "./core/rhythm/tuplet";
export * from "./core/rhythm/measure-timeline";

export { default as EXAMPLE_MVP_5_1_DOCUMENT } from "../example/example-mvp5.1.json";

export * from "./editing/tuplet-selection";

export * from "./core/music-text/music-text";
export * from "./core/chords/chord-diagram";

export * from "./core/chords/chord-presets";
export { default as EXAMPLE_MVP_6_DOCUMENT } from "../example/example-mvp6.json";

export * from "./core/lyrics/lyric-sequence";
export * from "./core/lyrics/lyric-positions";

export { default as EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT } from "../example/example-technique-rhythm";

export * from "./core/commands/command-effects";

export { default as EXAMPLE_MUTED_NOTE_DOCUMENT } from "../example/example-muted-note";

export * from "./core/document/tuning";

export * from "./core/numbered/numbered-notation";

export * from "./core/rhythm/beat-clipboard";
export * from "./core/rhythm/beat-structure";
export * from "./core/rhythm/beat-sustain";

export {
  EXAMPLE_MVP7C_DOCUMENT,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
  createMvp7cExample,
} from "../example/example-mvp7c";
export { createQualityScore } from "../example/quality-score";
export { default as EXAMPLE_MVP_7_2_DOCUMENT } from "../example/example-mvp7.2";
export { default as DEFAULT_MOCK_DOCUMENT } from "../example/default-score";
export { tabInputRhythmFromNumbered, prepareTabInputRhythm } from "./core/rhythm/tab-input-rhythm";

export * from "./core/numbered/numbered-rhythm";
export * from "./core/numbered/numbered-timeline";
export * from "./core/numbered/numbered-commands";
export * from "./core/numbered/numbered-marks";
export * from "./core/numbered/numbered-clipboard";
export { getMeasureCapacityTicks, calculateRhythmTicks } from "./core/rhythm/rhythm";
export * from "./core/numbered/numbered-input-ranges";
export * from "./core/chords/chord-catalog";
export * from "./core/document/score-tonality";
export * from "./core/chords/chord-diagram-edit";
