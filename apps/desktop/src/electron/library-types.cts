import type { EditorHost, EditorHostFile, EditorHostResult } from "@liuxianmao/lxm-editor-react" with { "resolution-mode": "import" };

export type ScoreSummary = {
  title: string;
  arranger: string;
  tonality: string;
  meter: string;
  measures: number;
};

export type LibraryEntry = ScoreSummary & {
  id: string;
  displayName: string;
  path: string;
  name: string;
  savedAt: number;
  openedAt: number;
};

export type ScoreCandidate = EditorHostFile & { path: string; bytes: ArrayBuffer; registered: boolean };
export type IndexWarning = { id: string; message: string };
export type LibraryOutcome<T> = { file: T; warning?: IndexWarning; resolvedWarning?: string };

/** 两类 ID 的用途彼此独立。谱库 ID 跨启动，预览和保存的文件 ID 属于当前窗口。 */
export interface DesktopBridge extends Omit<EditorHost, "openScore" | "saveScore"> {
  openScore(): Promise<EditorHostResult<ScoreCandidate>>;
  importScore(): Promise<EditorHostResult<ScoreCandidate>>;
  openLibraryScore(id: string): Promise<EditorHostResult<ScoreCandidate>>;
  relocateScore(id: string): Promise<EditorHostResult<ScoreCandidate>>;
  acceptScore(fileId: string, summary: ScoreSummary): Promise<EditorHostResult<LibraryOutcome<EditorHostFile>>>;
  discardScore(fileId: string): Promise<EditorHostResult>;
  saveScore(request: Parameters<EditorHost["saveScore"]>[0], summary: ScoreSummary): Promise<EditorHostResult<LibraryOutcome<EditorHostFile>>>;
  listLibrary(): Promise<EditorHostResult<LibraryEntry[]>>;
  renameLibraryScore(id: string, name: string): Promise<EditorHostResult>;
  removeLibraryScore(id: string): Promise<EditorHostResult>;
  retryRegistration(id: string): Promise<EditorHostResult>;
}
