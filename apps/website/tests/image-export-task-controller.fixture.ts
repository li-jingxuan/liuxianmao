import type { PreparedScoreImages } from "../components/EditorShell/output/image-export-controller";
export {
  MAX_IMAGE_PAGES,
  pageImageName,
  toImageExportError,
  ImageExportError,
} from "../components/EditorShell/output/image-export-controller";

// 浏览器夹具故意不响应 abort，让测试能交付取消后的迟到结果。
interface PendingTask<T> {
  signal: AbortSignal;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}
export const preparations: PendingTask<PreparedScoreImages>[] = [];
export const encodings: PendingTask<Blob>[] = [];
export const prepareScoreImages = (
  _document: unknown,
  _density: unknown,
  _diagrams: unknown,
  signal: AbortSignal,
): Promise<PreparedScoreImages> => new Promise((resolve, reject) => {
  preparations.push({ signal, resolve, reject });
});
export const encodeScorePage = (
  _prepared: unknown,
  _index: number,
  signal: AbortSignal,
): Promise<Blob> => new Promise((resolve, reject) => {
  encodings.push({ signal, resolve, reject });
});
export const exportScoreImages = (): never => {
  throw new Error("此夹具只验证单页任务生命周期");
};
