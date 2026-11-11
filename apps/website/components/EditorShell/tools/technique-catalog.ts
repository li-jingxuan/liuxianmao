import type { ILXMTechniqueType } from "@liuxianmao/lxm-editor";

/** 类型、中文名与分组只有这一份目录，参数和选择器共同消费。 */
export const TECHNIQUE_GROUPS: {
  label: string;
  items: { value: ILXMTechniqueType; label: string }[];
}[] = [
  {
    label: "音符连接",
    items: [
      { value: "hammerOn", label: "击弦 H" },
      { value: "pullOff", label: "勾弦 P" },
      { value: "slideUp", label: "上滑音" },
      { value: "slideDown", label: "下滑音" },
      { value: "tie", label: "延音线" },
    ],
  },
  {
    label: "音高与修饰",
    items: [
      { value: "bend", label: "推弦" },
      { value: "vibrato", label: "颤音" },
      { value: "naturalHarmonic", label: "自然泛音" },
      { value: "artificialHarmonic", label: "人工泛音" },
      { value: "tapping", label: "点弦 T" },
      { value: "trill", label: "颤音奏 tr" },
    ],
  },
  {
    label: "演奏方向与范围",
    items: [
      { value: "strum", label: "扫弦" },
      { value: "arpeggio", label: "琶音" },
      { value: "pickStroke", label: "拨片方向" },
      { value: "palmMute", label: "手掌闷音 P.M." },
      { value: "letRing", label: "Let Ring" },
    ],
  },
];
export const TECHNIQUE_OPTIONS = TECHNIQUE_GROUPS.flatMap(
  (group) => group.items,
);
