export const MUSIC_CONTROL_ICON_IDS = [
  "noteWhole",
  "noteHalf",
  "noteQuarter",
  "noteEighth",
  "noteSixteenth",
  "noteThirtySecond",
  "noteDot",
  "noteDoubleDotted",
  "noteTie",
  "duplet",
  "triplet",
  "quadruplet",
  "quintupletFiveFour",
  "quintupletFiveThree",
  "sextuplet",
  "measureAdd",
  "measureRemove",
  "actionsCopy",
] as const;

export type MusicControlIcon = (typeof MUSIC_CONTROL_ICON_IDS)[number];

export interface SvgAssetDefinition {
  id: MusicControlIcon;
  sourcePath: string;
  runtimePath: string;
  usage: "toolbar" | "scoreGlyph";
  source: string;
  license: string;
}

const USER_PROVIDED_SOURCE = "用户提供的参考素材";
const INTERNAL_USE_LICENSE = "仅限本项目内部使用，禁止外部分发";

/** 组件只能通过语义 ID 查询资源，禁止自行拼接运行时路径。 */
export const SVG_ASSETS_MANIFEST: readonly SvgAssetDefinition[] = [
  ["noteWhole", "note-whole.svg"],
  ["noteHalf", "note-half.svg"],
  ["noteQuarter", "note-quarter.svg"],
  ["noteEighth", "note-eighth.svg"],
  ["noteSixteenth", "note-sixteenth.svg"],
  ["noteThirtySecond", "note-thirty-second.svg"],
  ["noteDot", "note-dot.svg"],
  ["noteDoubleDotted", "note-double-dotted.svg"],
  ["noteTie", "note-tie.svg"],
  ["duplet", "duplet.svg"],
  ["triplet", "triplet.svg"],
  ["quadruplet", "quadruplet.svg"],
  ["quintupletFiveFour", "quintuplet-5-4.svg"],
  ["quintupletFiveThree", "quintuplet-5-3.svg"],
  ["sextuplet", "sextuplet.svg"],
  ["measureAdd", "measure-add24.svg"],
  ["measureRemove", "measure-remove24.svg"],
  ["actionsCopy", "actions-copy24.svg"],
].map(([id, fileName]) => ({
  id: id as MusicControlIcon,
  sourcePath: `docs/extracted-svg-icons/${fileName}`,
  runtimePath: `/assets/svg/music-controls/${fileName}`,
  usage: "toolbar" as const,
  source: USER_PROVIDED_SOURCE,
  license: INTERNAL_USE_LICENSE,
}));

export const getSvgAsset = (id: MusicControlIcon): SvgAssetDefinition => {
  const asset = SVG_ASSETS_MANIFEST.find((item) => item.id === id);
  if (!asset) throw new Error(`未注册的 SVG 资源：${id}`);
  return asset;
};
