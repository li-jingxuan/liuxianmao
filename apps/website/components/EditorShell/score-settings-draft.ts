import {
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMKeySignature,
} from "@liuxianmao/lxm-editor";
export interface ScoreSettingsDraft {
  title: string;
  arranger: string;
  keySignature: ILXMKeySignature | null;
  capo: string;
  signature: string;
  label: string;
}
/** 设置草稿只读取当前领域快照，拍号永远取第一小节。 */
export const readScoreSettings = (
  document: ILXMDocument,
  measureId?: string,
): ScoreSettingsDraft => {
  const track = document.score.tracks[0]!;
  const time = track.measures[0]!.timeSignature;
  return {
    title: document.score.title,
    arranger: document.score.arranger,
    keySignature: document.score.keySignature,
    capo: String(track.capo),
    signature: `${time.numerator}/${time.denominator}`,
    label: track.measures.find((m) => m.id === measureId)?.sectionLabel ?? "",
  };
};
export type SettingsGroup = "info" | "capo" | "signature" | "label";
export const settingsKeys = {
  info: ["title", "arranger", "keySignature"],
  capo: ["capo"],
  signature: ["signature"],
  label: ["label"],
} as const;
/** 按表单分组提交；用于提前验证“应用后继续”，不生成 UI 层时间轴算法。 */
export const planSettingsCommands = (
  document: ILXMDocument,
  value: ScoreSettingsDraft,
  initial: ScoreSettingsDraft,
  measureId?: string,
  group?: SettingsGroup,
): ILXMScoreCommand[] => {
  const track = document.score.tracks[0]!;
  const changed = (g: SettingsGroup) =>
    (!group || group === g) &&
    settingsKeys[g].some((k) => value[k] !== initial[k]);
  const commands: ILXMScoreCommand[] = [];
  if (changed("info"))
    commands.push({
      type: LXMScoreCommandEnum.SetNotationInfo,
      title: value.title,
      arranger: value.arranger,
      keySignature: value.keySignature,
    });
  if (changed("capo"))
    commands.push({
      type: LXMScoreCommandEnum.SetCapo,
      trackId: track.id,
      capo: value.capo === "" ? NaN : Number(value.capo),
    });
  if (changed("signature")) {
    const [numerator, denominator] = value.signature.split("/").map(Number);
    commands.push({
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: track.id,
      measureId: track.measures[0]!.id,
      timeSignature: { numerator: numerator!, denominator: denominator! },
      scope: "untilNextChange",
    });
  }
  if (changed("label") && measureId)
    commands.push({
      type: LXMScoreCommandEnum.SetSectionLabel,
      trackId: track.id,
      measureId,
      label: value.label,
    });
  return commands;
};
