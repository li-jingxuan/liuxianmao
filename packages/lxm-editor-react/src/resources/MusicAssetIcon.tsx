import type { CSSProperties } from "react";
import { useEditorResources } from "./editor-resources";

// 文件名是宿主资源约定。默认用 Bravura 字形和文字渲染同一语义，以便组件离线起用。
const icons = {
  noteWhole: ["note-whole.svg", "\uE1D2"],
  noteHalf: ["note-half.svg", "\uE1D3"],
  noteQuarter: ["note-quarter.svg", "\uE1D5"],
  noteEighth: ["note-eighth.svg", "\uE1D7"],
  noteSixteenth: ["note-sixteenth.svg", "\uE1D9"],
  noteThirtySecond: ["note-thirty-second.svg", "\uE1DB"],
  noteDot: ["note-dot.svg", "\uE1E7"],
  noteDoubleDotted: ["note-double-dotted.svg", "\uE1E7\uE1E7"],
  noteTie: ["note-tie.svg", "⌒"],
  duplet: ["duplet.svg", "2"],
  triplet: ["triplet.svg", "3"],
  quadruplet: ["quadruplet.svg", "4"],
  quintupletFiveFour: ["quintuplet-5-4.svg", "5:4"],
  quintupletFiveThree: ["quintuplet-5-3.svg", "5:3"],
  sextuplet: ["sextuplet.svg", "6"],
  measureAdd: ["measure-add24.svg", "+"],
  measureRemove: ["measure-remove24.svg", "−"],
  actionsCopy: ["actions-copy24.svg", "⧉"],
} as const;

export type MusicControlIcon = keyof typeof icons;

export function MusicAssetIcon({ assetId, className }: { assetId: MusicControlIcon; className?: string }) {
  const { paths } = useEditorResources();
  const [file, glyph] = icons[assetId];
  if (paths?.musicIconBaseUrl) {
    const url = `${paths.musicIconBaseUrl.replace(/\/$/, "")}/${file}`;
    return <span className={className} style={{ "--music-icon-url": `url(${JSON.stringify(url)})` } as CSSProperties} aria-hidden="true" />;
  }
  return <span className={className} data-lxm-music-glyph={glyph.charCodeAt(0) >= 0xE000 ? "music" : "text"} aria-hidden="true">{glyph}</span>;
}
