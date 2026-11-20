/** 编辑器临时交互使用的历史动作。 */
export type EditorHistoryAction = "undo" | "redo";

export interface EditorHistoryShortcutInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export type BeatKindShortcutAction = "setRest" | "unsetRest";

export interface BeatKindShortcutInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 单键只在谱面入口生效；带系统修饰键的 R 完全交还浏览器。 */
export const resolveBeatKindShortcut = (
  input: BeatKindShortcutInput,
): BeatKindShortcutAction | null => {
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if (input.key.toLowerCase() !== "r") return null;
  return input.shiftKey ? "unsetRest" : "setRest";
};

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

/** x 弹奏标记只在谱面入口接管；系统快捷键和输入法组合键保持原行为。 */
export const resolveMutedNoteShortcut = (
  input: BeatKindShortcutInput & { isComposing?: boolean },
): boolean =>
  !input.metaKey &&
  !input.ctrlKey &&
  !input.altKey &&
  !input.isComposing &&
  input.key.toLowerCase() === "x";

/** TAB 弦格的横线延音标记；组合输入和系统快捷键不接管。 */
export const resolveTabContinuationShortcut = (
  input: BeatKindShortcutInput & { isComposing?: boolean },
): boolean =>
  !input.metaKey &&
  !input.ctrlKey &&
  !input.altKey &&
  !input.isComposing &&
  input.key === "-";
