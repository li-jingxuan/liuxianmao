/** 系统菜单和工作区共享的动作。关闭需要编辑器核对草稿和保存状态后明确响应。 */
export type EditorHostAction = "open" | "save" | "saveAs" | "print" | "close";

export type EditorHostResult<T = void> =
  | { status: "ok"; value: T }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/** 宿主保管真实路径，编辑器只保存文件名和该窗口获准访问的标识。 */
export type EditorHostFile = { id: string; name: string };

export interface EditorHost {
  openScore(): Promise<EditorHostResult<EditorHostFile & { bytes: ArrayBuffer; path?: string }>>;
  /** 具备文件索引的宿主可在预览确认后复核原件。取消或未通过校验的预览没有写入权限。 */
  confirmOpenScore?(file: EditorHostFile, document: import("@liuxianmao/lxm-editor").ILXMDocument): Promise<EditorHostResult>;
  discardOpenScore?(fileId: string): void;
  saveScore(request: { fileId?: string; suggestedName: string; text: string; confirmUpgrade?: boolean }): Promise<EditorHostResult<EditorHostFile>>;
  writeOutput(request: { suggestedName: string; bytes: ArrayBuffer }): Promise<EditorHostResult>;
  print(): Promise<EditorHostResult>;
  onAction(listener: (action: EditorHostAction) => void): () => void;
  resolveClose(allow: boolean): void;
}
