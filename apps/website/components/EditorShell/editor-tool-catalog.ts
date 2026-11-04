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
