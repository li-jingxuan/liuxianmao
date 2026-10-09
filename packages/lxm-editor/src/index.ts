export * from "./layout";
export * from "./layout/layout-types";
/** 渲染层共用品位文字与 marker 尺寸，避免出现核心不知道的视觉外延。 */
export {
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
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
