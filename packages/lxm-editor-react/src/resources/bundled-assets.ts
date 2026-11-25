export interface BundledGuitarSamples {
  manifest: unknown;
  /** 返回编码文件内容，延迟到实际试听请求该采样时再加载对应模块。 */
  load(file: string, codec: "ogg" | "m4a"): Promise<string>;
}

// 构建插件注入已审核的资源与静态动态导入。仓库直接运行源码时仍可访问宿主的 HTTP 目录。
export const bundledGuitarSamples: BundledGuitarSamples | undefined = undefined;
export const loadBundledChordCatalog: (() => Promise<unknown>) | undefined = undefined;
