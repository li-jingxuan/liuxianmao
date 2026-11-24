/** 网站和工作区验收使用的谱例。生产 npm 构建只从 src/public.ts 开始收集依赖。 */
export { default as DEFAULT_MOCK_DOCUMENT } from "./default-score";
export * as EXAMPLE from "./index";
export { default as EXAMPLE_MVP_4_DOCUMENT } from "./example-mvp4.json";
export { default as EXAMPLE_MVP_5_DOCUMENT } from "./example-mvp5.json";
export { default as EXAMPLE_MVP_5_1_DOCUMENT } from "./example-mvp5.1.json";
export { default as EXAMPLE_MVP_6_DOCUMENT } from "./example-mvp6.json";
export { default as EXAMPLE_MVP_7_2_DOCUMENT } from "./example-mvp7.2";
export { default as EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT } from "./example-technique-rhythm";
export { default as EXAMPLE_MUTED_NOTE_DOCUMENT } from "./example-muted-note";
export { EXAMPLE_MVP7C_DOCUMENT, EXAMPLE_MVP7C_LONG_DOCUMENT, createMvp7cExample } from "./example-mvp7c";
export { createQualityScore } from "./quality-score";
