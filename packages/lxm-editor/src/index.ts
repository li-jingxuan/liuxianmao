export * from "./layout";
export * from "./layout/layout-types";
export * from "./editing/navigation";
export * from "./editing/tab-cell-selection";
export * from "./core/constants";
export * from "./core/id-factory";
export * from "./core/commands";
export * from "./core/loader";
export * from "./core/schema";
export * from "./core/semantic-validation";
export * from "./core/time-signature-change";
export * from "./core/types";

/**
 * v4 页面直接使用具名文档导出，避免旧版 example/index.js 构建产物遮蔽新的 TS
 * namespace 导出；后续清理历史构建产物时可再统一 EXAMPLE 门面。
 */
export { default as EXAMPLE_MVP_4_DOCUMENT } from "../example/example-mvp4.json";

export * as EXAMPLE from "../example";
