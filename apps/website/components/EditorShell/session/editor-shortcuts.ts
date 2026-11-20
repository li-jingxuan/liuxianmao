/** 工具提示使用统一的快捷键描述，不注册第二套键盘监听。 */
export const EDITOR_SHORTCUTS = {
  undo: { keys: "Ctrl / ⌘ + Z", description: "撤销（输入框保留原生撤销）" },
  redo: { keys: "Ctrl / ⌘ + Shift + Z；Ctrl + Y", description: "重做" },
  navigation: {
    keys: "方向键 / Shift + 方向键",
    description: "TAB 导航 / 扩展选区",
  },
  fret: {
    keys: "0–9",
    description: "按键即写入品位，快速连按可输入 10–24 品",
  },
  muted: { keys: "X", description: "输入 x 弹奏标记" },
  remove: { keys: "Backspace / Delete", description: "删除所选技巧或音符" },
  rest: { keys: "R", description: "整拍设为休止" },
  restore: { keys: "Shift + R", description: "取消休止，原音符可通过撤销恢复" },
  escape: {
    keys: "Esc",
    description: "收拢 TAB 选区；文字编辑先处理草稿",
  },
  lyric: {
    keys: "Enter / Shift + Enter",
    description: "歌词单拍应用并下一拍 / 仅应用",
  },
} as const;
export const editorShortcutLabel = (key: keyof typeof EDITOR_SHORTCUTS) =>
  `${EDITOR_SHORTCUTS[key].description}（${EDITOR_SHORTCUTS[key].keys}）`;
