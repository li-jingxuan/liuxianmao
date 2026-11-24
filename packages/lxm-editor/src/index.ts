/**
 * 工作区源码兼容入口。现有验收脚本和 Core 测试直接引用本文件，
 * 因此继续提供旧谱例导出。npm 从 public.ts 构建，依赖图与此入口隔离。
 */
export * from "./public";
export * from "../example/fixtures";
