import type { CSSProperties } from "react";
import { useEditorResources } from "./editor-resources";

// 文件名沿用 Web 图标目录的约定，也用于匹配工具栏样式中的内置 SVG。
const icons = {
  noteWhole: "note-whole",
  noteHalf: "note-half",
  noteQuarter: "note-quarter",
  noteEighth: "note-eighth",
  noteSixteenth: "note-sixteenth",
  noteThirtySecond: "note-thirty-second",
  noteDot: "note-dot",
  noteDoubleDotted: "note-double-dotted",
  noteTie: "note-tie",
  duplet: "duplet",
  triplet: "triplet",
  quadruplet: "quadruplet",
  quintupletFiveFour: "quintuplet-5-4",
  quintupletFiveThree: "quintuplet-5-3",
  sextuplet: "sextuplet",
  measureAdd: "measure-add24",
  measureRemove: "measure-remove24",
  actionsCopy: "actions-copy24",
} as const;

export type MusicControlIcon = keyof typeof icons;

export function MusicAssetIcon({ assetId, className }: { assetId: MusicControlIcon; className?: string }) {
  const { paths } = useEditorResources();
  const name = icons[assetId];
  // 宿主提供目录时按相同文件名加载，其余情况由 CSS 选择构建时内联的原图。
  if (paths?.musicIconBaseUrl) {
    const url = `${paths.musicIconBaseUrl.replace(/\/$/, "")}/${name}.svg`;
    return <span className={className} style={{ "--music-icon-url": `url(${JSON.stringify(url)})` } as CSSProperties} aria-hidden="true" />;
  }
  return <span className={className} data-lxm-music-icon={name} aria-hidden="true" />;
}
