import type { ImageExportSnapshot } from "./image-export-controller";

export type ExportStatus =
  | "preparing"
  | "ready"
  | "generating"
  | "generated"
  | "failed"
  | "stale";
export type ExportRange = { type: "all" } | { type: "page"; index: number };
export interface DownloadState {
  url: string;
  name: string;
  range: "all" | number;
}

export interface ImageExportTaskOptions {
  snapshot: ImageExportSnapshot;
  isCurrent: () => boolean;
  /** 准备失效直接卸载；生成失效沿用 Modal 的关闭动画。 */
  onInvalid: (stage: "prepare" | "generate") => void;
}
