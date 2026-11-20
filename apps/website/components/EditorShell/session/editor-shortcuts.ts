export type ShortcutPlatform = "mac" | "pc";

type Shortcut = {
  label: string;
  keys: readonly string[];
  pcKeys?: readonly string[];
  detail?: string;
  aliases?: string;
};

/** Catalog for the reference dialog and contextual hints. The editor owns key handling. */
export const EDITOR_SHORTCUTS = {
  undo: { label: "撤销", keys: ["$mod + Z"], detail: "撤销谱面修改。文本框内保留原生撤销。" },
  redo: { label: "重做", keys: ["$mod + Shift + Z"], pcKeys: ["Ctrl + Shift + Z", "Ctrl + Y"] },
  tabMove: { label: "移动选中格", keys: ["方向键"], aliases: "arrow ↑ ↓ ← →", detail: "焦点在六线谱上时生效。" },
  tabSelect: { label: "扩展六线谱选区", keys: ["Shift + 方向键"], aliases: "arrow ↑ ↓ ← →" },
  fret: { label: "输入品位", keys: ["0–9"], detail: "按键即写入品位，快速连按可输入 10–24 品。" },
  muted: { label: "输入 x 弹奏标记", keys: ["X"] },
  sustain: { label: "输入横线延音标记", keys: ["-"] },
  rest: { label: "设为休止", keys: ["R"], detail: "在六线谱选中拍点时，整拍设为休止。" },
  restore: { label: "取消休止", keys: ["Shift + R"], detail: "取消后得到空拍，恢复原音符可使用撤销。" },
  remove: { label: "删除选中的音符或技巧", keys: ["Backspace", "Delete"], detail: "焦点在六线谱上时生效。" },
  tabEscape: { label: "收拢选区", keys: ["Esc"] },
  textNavigate: { label: "前／后一个录入位置", keys: ["$alt + ←/→"], aliases: "arrow left right", detail: "在歌词或简谱单项输入框及对应的谱面选中位置生效。" },
  textMove: { label: "移动连续选区焦点", keys: ["←/→"], aliases: "arrow left right", detail: "在谱面上移动歌词或简谱范围。" },
  textSelect: { label: "扩展连续选区", keys: ["Shift + ←/→"], aliases: "arrow left right", detail: "在谱面上扩展歌词或简谱范围。" },
  textDelete: { label: "清除连续选区内容", keys: ["Backspace", "Delete"], detail: "焦点在谱面上时生效。" },
  textEscape: { label: "收拢连续选区或退出单项编辑", keys: ["Esc"], detail: "单项编辑沿用草稿与浮窗的退出规则。" },
  lyricNewline: { label: "歌词输入换行", keys: ["Enter"], detail: "空格或换行可分隔录入位置。" },
  apply: { label: "应用输入", keys: ["Enter"], detail: "在简谱、和弦和歌词／简谱范围的输入框生效。" },
  applyRhythmPattern: { label: "应用节奏型", keys: ["Enter"], detail: "在节奏型面板或已选模板上生效。" },
  applyModified: { label: "应用当前属性编辑", keys: ["$mod + Enter"], detail: "适用于歌词、简谱和和弦。单项歌词应用后留在当前位置。" },
  settings: { label: "应用设置或技巧参数", keys: ["Enter"], detail: "在歌曲或小节设置输入框应用当前修改组，在技巧数字输入框提交参数。" },
  gridMove: { label: "移动指法网格焦点", keys: ["方向键"], aliases: "arrow ↑ ↓ ← →" },
  gridApply: { label: "操作当前指法格", keys: ["Enter", "Space"] },
  finger: { label: "设置手指、拇指或未指定", keys: ["1–4", "T", "0"], detail: "先选中一个按点。" },
  diagramUndo: { label: "撤销指法修改", keys: ["$mod + Z"] },
  diagramRedo: { label: "重做指法修改", keys: ["$mod + Shift + Z", "$mod + Y"] },
  diagramApply: { label: "完成指法编辑", keys: ["Enter"], detail: "焦点在指法文本框时生效。" },
  diagramExit: { label: "关闭指法编辑", keys: ["Esc"], detail: "沿用指法草稿保护。" },
} satisfies Record<string, Shortcut>;

export type EditorShortcut = keyof typeof EDITOR_SHORTCUTS;

export const EDITOR_SHORTCUT_GROUPS: { title: string; shortcuts: EditorShortcut[] }[] = [
  { title: "编辑历史", shortcuts: ["undo", "redo"] },
  { title: "六线谱（TAB）", shortcuts: ["tabMove", "tabSelect", "fret", "muted", "sustain", "rest", "restore", "remove", "tabEscape"] },
  { title: "歌词、简谱与和弦", shortcuts: ["textNavigate", "textMove", "textSelect", "textDelete", "textEscape", "lyricNewline", "apply", "applyModified"] },
  { title: "曲谱设置与技巧", shortcuts: ["settings", "applyRhythmPattern"] },
  { title: "自定义和弦指法", shortcuts: ["gridMove", "gridApply", "finger", "diagramUndo", "diagramRedo", "diagramApply", "diagramExit"] },
];

export const editorShortcut = (id: EditorShortcut): Shortcut => EDITOR_SHORTCUTS[id];

export const shortcutKeys = (id: EditorShortcut, platform: ShortcutPlatform) => {
  const shortcut = editorShortcut(id);
  return (platform === "pc" ? shortcut.pcKeys ?? shortcut.keys : shortcut.keys).map((keys) =>
    keys.replaceAll("$mod", platform === "mac" ? "⌘" : "Ctrl")
      .replaceAll("$alt", platform === "mac" ? "⌥" : "Alt"),
  );
};

const normalize = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/⌘|\b(?:cmd|command)\b/g, " command ")
  .replace(/⌥|\b(?:alt|option)\b/g, " option ")
  .replace(/\bcontrol\b/g, " ctrl ")
  .replace(/\bescape\b/g, " esc ")
  .replace(/\breturn\b|回车/g, " enter ")
  .replace(/\+/g, " ").trim();

export function findEditorShortcuts(query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return EDITOR_SHORTCUT_GROUPS.map(({ title, shortcuts }) => ({
    title,
    shortcuts: shortcuts.filter((id) => {
      const { label, detail, aliases } = editorShortcut(id);
      const text = normalize([title, label, detail, aliases, ...shortcutKeys(id, "mac"), ...shortcutKeys(id, "pc")].join(" "));
      const words: readonly string[] = text.match(/[a-z0-9]+/g) ?? [];
      return terms.every((term) => /^[a-z0-9]$/.test(term) ? words.includes(term) : text.includes(term));
    }),
  })).filter(({ shortcuts }) => shortcuts.length > 0);
}
