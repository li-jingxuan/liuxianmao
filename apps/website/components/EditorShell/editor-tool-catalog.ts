export type ToolGroupId = "measure" | "beat" | "tuplet" | "technique";
export type ToolNavigation =
  | "note"
  | "measure"
  | "barline"
  | "tuplet"
  | "section"
  | "copy";
export const TOOL_GROUPS: { id: ToolGroupId; label: string }[] = [
  { id: "measure", label: "小节" },
  { id: "beat", label: "拍点" },
  { id: "tuplet", label: "连音" },
  { id: "technique", label: "技巧" },
];
/** 搜索只定位动作，不保存命令闭包或文档快照。 */
export const EDITOR_TOOL_CATALOG: {
  id: string;
  group: ToolGroupId;
  label: string;
  keywords: string;
}[] = [
  {
    id: "measure-actions",
    group: "measure",
    label: "小节：新增、直接复制、删除",
    keywords: "小节 新建 移除 副本",
  },
  {
    id: "measure-properties",
    group: "measure",
    label: "小节属性：拍号、六类小节线",
    keywords: "拍号 边界 反复 终止 右边界 段落 标记 范围复制",
  },
  {
    id: "beat-actions",
    group: "beat",
    label: "拍点：拆分、合并、复制",
    keywords: "拍点 拆合 全部六弦 双谱 仅六线谱",
  },
  {
    id: "beat-paste",
    group: "beat",
    label: "粘贴：目标前插入、从目标覆盖",
    keywords: "粘贴 插入 覆盖 预览 剪贴板",
  },
  {
    id: "tuplet-actions",
    group: "tuplet",
    label: "TAB 连音：六比例、删除当前组",
    keywords: "连音 2:3 3:2 4:3 5:4 5:3 6:4",
  },
  {
    id: "technique-actions",
    group: "technique",
    label: "技巧：16 类选择、参数与编辑",
    keywords:
      "击弦 勾弦 滑音 延音 推弦 颤音 泛音 点弦 颤音奏 扫弦 琶音 拨片 手掌闷音 Let Ring 方向 辅助品位",
  },
];
export const findEditorTools = (query: string) => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return EDITOR_TOOL_CATALOG.filter((item) =>
    terms.every((term) =>
      `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(term),
    ),
  );
};
