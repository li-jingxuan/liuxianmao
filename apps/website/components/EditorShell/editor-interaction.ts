/** 编辑器临时交互使用的历史动作。 */
export type EditorHistoryAction = "undo" | "redo";

export interface EditorHistoryShortcutInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * 将编辑器级历史快捷键解析为明确动作。
 *
 * 该纯函数不读取 DOM，也不执行 preventDefault；页面只有在返回动作时才接管按键。
 */
export const resolveEditorHistoryShortcut = (
  input: EditorHistoryShortcutInput,
  availability: { canUndo: boolean; canRedo: boolean },
): EditorHistoryAction | null => {
  const key = input.key.toLowerCase();
  const primaryModifier = input.metaKey || input.ctrlKey;

  if (primaryModifier && key === "z") {
    if (input.shiftKey) return availability.canRedo ? "redo" : null;
    return availability.canUndo ? "undo" : null;
  }

  if (input.ctrlKey && key === "y") return availability.canRedo ? "redo" : null;

  return null;
};

export interface DeferredFretDraftCommit {
  schedule: (draft: string, commit: (draft: string) => void) => void;
  cancel: () => void;
}

/**
 * 创建可取消的品位草稿延迟提交器。
 *
 * generation 除了配合 clearTimeout，还能让已经进入任务队列的旧回调自行失效，
 * 避免用户执行撤销、切换工具或重新选择后，旧草稿又写回 document。
 */
export const createDeferredFretDraftCommit = (
  timeoutMs: number,
): DeferredFretDraftCommit => {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule: DeferredFretDraftCommit["schedule"] = (draft, commit) => {
    cancel();
    const scheduledGeneration = generation;
    timer = setTimeout(() => {
      if (scheduledGeneration !== generation) return;
      timer = null;
      commit(draft);
    }, timeoutMs);
  };

  return { schedule, cancel };
};
