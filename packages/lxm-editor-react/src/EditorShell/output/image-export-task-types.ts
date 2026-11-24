import type { EditorHost } from "../../editor-host";
import type { ImageExportSnapshot } from "./image-export-controller";
import type { ScoreWatermark } from "./score-watermark";

export type ExportStatus =
  | "preparing"
  | "ready"
  | "generating"
  | "generated"
  | "failed"
  | "stale";
export type ExportRange = { type: "all" } | { type: "page"; index: number };
/** 同一成品按交付方式保留浏览器下载地址或可再次保存的原始 Blob。 */
export type DownloadState = {
  name: string;
  range: "all" | number;
} & ({ url: string } | { blob: Blob });

export interface ImageExportTaskOptions {
  snapshot: ImageExportSnapshot;
  /** 只在生成开始时取已应用的水印，调整试排不影响分页快照。 */
  watermark?: ScoreWatermark;
  isCurrent: () => boolean;
  writeOutput?: EditorHost["writeOutput"];
  /** 准备失效直接卸载；生成失效沿用 Modal 的关闭动画。 */
  onInvalid: (stage: "prepare" | "generate") => void;
}
