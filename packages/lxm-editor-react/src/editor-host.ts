/** 系统菜单和工作区共享的动作。关闭需要编辑器核对草稿和保存状态后明确响应。 */
export type EditorHostAction = "open" | "save" | "saveAs" | "print" | "close";

export type EditorHostResult<T = void> =
  | { status: "ok"; value: T }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/** 宿主保管真实路径，编辑器只保存文件名和该窗口获准访问的标识。 */
export type EditorHostFile = { id: string; name: string };

export interface EditorHost {
  openScore(): Promise<EditorHostResult<EditorHostFile & { bytes: ArrayBuffer }>>;
  saveScore(request: { fileId?: string; suggestedName: string; text: string; confirmUpgrade?: boolean }): Promise<EditorHostResult<EditorHostFile>>;
  writeOutput(request: { suggestedName: string; bytes: ArrayBuffer }): Promise<EditorHostResult>;
  print(): Promise<EditorHostResult>;
  onAction(listener: (action: EditorHostAction) => void): () => void;
  resolveClose(allow: boolean): void;
}
