import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";

export interface ToolOption {
  readonly icon: string;
  readonly label: string;
  readonly active?: boolean;
  readonly assetId?: MusicControlIcon;
}

/** Bravura 仅用于尚未进入正式 SVG 渲染的音乐点状符号。 */
export const BRAVURA_SYMBOLS = {
  noteWhole: "\uE1D3",
  noteHalf: "\uE1D4",
  noteQuarter: "\uE1D5",
  noteEighth: "\uE1D7",
  noteSixteenth: "\uE1D9",
  noteThirtySecond: "\uE1DB",
  restQuarter: "\uE4E5",
  timeSigCommon: "\uE08A",
  barlineSingle: "\uE030",
  accidentalSharp: "\uE262",
  repeatDots: "\uE044",
  gClef: "\uE050",
} as const;

export const TOOLBAR_SECTIONS: readonly (readonly ToolOption[])[] = [
  [
    {
      icon: BRAVURA_SYMBOLS.noteQuarter,
      label: "音符",
      active: true,
      assetId: "noteQuarter",
    },
    { icon: BRAVURA_SYMBOLS.restQuarter, label: "休止符" },
    { icon: BRAVURA_SYMBOLS.timeSigCommon, label: "节拍" },
    { icon: BRAVURA_SYMBOLS.barlineSingle, label: "小节线" },
    { icon: BRAVURA_SYMBOLS.accidentalSharp, label: "和弦" },
    { icon: "T", label: "文本" },
  ],
  [
    { icon: BRAVURA_SYMBOLS.repeatDots, label: "重复" },
    { icon: BRAVURA_SYMBOLS.gClef, label: "调号" },
    {
      icon: BRAVURA_SYMBOLS.noteQuarter,
      label: "速度",
      assetId: "noteQuarter",
    },
  ],
] as const;

export const NOTE_OPTIONS: readonly Omit<ToolOption, 'icon'>[] = [
  { label: "全音符", assetId: "noteWhole" },
  { label: "二分音符", assetId: "noteHalf" },
  {
    label: "四分音符",
    active: true,
    assetId: "noteQuarter",
  },
  {
    label: "八分音符",
    assetId: "noteEighth",
  },
  {
    label: "十六分音符",
    assetId: "noteSixteenth",
  },
  {
    label: "三十二分音符",
    assetId: "noteThirtySecond",
  },
] as const;

/** 技巧图标将在 Iteration 5 正式接入；当前只保留文字快捷键提示。 */
export const TECHNIQUE_OPTIONS = [
  { label: "击弦 (H)", assetId: "" },
  { label: "勾弦 (P)", assetId: "" },
  { label: "上滑音 (/)", assetId: "" },
  { label: "下滑音 (\\)", assetId: "" },
  { label: "推弦 (B)", assetId: "" },
  { label: "颤音 (V)", assetId: "" },
  { label: "泛音 (AH)", assetId: "" },
  { label: "闷音 (x)", assetId: "" },
] as const;

export const STAFF_STRINGS = [1, 2, 3, 4, 5, 6] as const;
