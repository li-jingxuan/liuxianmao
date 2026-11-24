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
export { sameTechniqueDraft } from "./core/techniques/technique-equality";
export * from "./core/types";
export * from "./core/document/document-history";

export * from "./core/rhythm/tuplet";
export * from "./core/rhythm/measure-timeline";
export * from "./core/rhythm/measure-duration-change";

export * from "./editing/tuplet-selection";

export * from "./core/music-text/music-text";
export * from "./core/chords/chord-diagram";

export * from "./core/chords/chord-presets";

export * from "./core/lyrics/lyric-sequence";
export * from "./core/lyrics/lyric-positions";
export * from "./core/lyrics/lyric-verses";
export { getMusicTextRows } from "./core/music-text/music-text-rows";
export {
  collectMusicTextRangeSlots,
  resolveMusicTextRange,
  readMusicTextRange,
  type MusicTextRange,
  type MusicTextRangePosition,
  type MusicTextRangeSlot,
} from "./core/music-text-range/music-text-range";

export * from "./core/commands/command-effects";

export * from "./core/document/tuning";

export * from "./core/numbered/numbered-notation";

export * from "./core/rhythm/beat-clipboard";
export * from "./core/rhythm/beat-structure";
export * from "./core/rhythm/beat-sustain";
export * from "./core/rhythm/rhythm-pattern";

export { tabInputRhythmFromNumbered, prepareTabInputRhythm } from "./core/rhythm/tab-input-rhythm";

export * from "./core/numbered/numbered-rhythm";
export * from "./core/numbered/numbered-timeline";
export * from "./core/numbered/numbered-commands";
export * from "./core/numbered/numbered-marks";
export * from "./core/numbered/numbered-clipboard";
export { getMeasureCapacityTicks, getMeasureDurationTicks, calculateRhythmTicks } from "./core/rhythm/rhythm";
export * from "./core/numbered/numbered-input-ranges";
export * from "./core/chords/chord-catalog";
export * from "./core/chords/chord-catalog-browse";
export * from "./core/document/score-tonality";
export * from "./core/chords/chord-diagram-edit";
export { isPureTabContinuationBeat, tabContinuationRhythm } from "./core/rhythm/tab-continuation";
export * from "./core/playback/plan";
