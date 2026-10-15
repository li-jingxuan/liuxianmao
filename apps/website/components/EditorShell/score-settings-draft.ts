import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMKeySignature,
  type ILXMApplyScoreCommandResult,
} from "@liuxianmao/lxm-editor";
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
  type EditorSessionVersion,
} from "./editor-session-version";

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
      capo: value.capo.trim() === "" ? NaN : Number(value.capo),
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

export interface SettingsIssue {
  group?: SettingsGroup;
  message: string;
}
export interface SettingsSubmissionResult {
  status: "applied" | "blocked" | "stale";
  submittedGroups: SettingsGroup[];
  issue: SettingsIssue | null;
}
const commandGroups = new Map<ILXMScoreCommand["type"], SettingsGroup>([
  [LXMScoreCommandEnum.SetNotationInfo, "info"],
  [LXMScoreCommandEnum.SetCapo, "capo"],
  [LXMScoreCommandEnum.SetTimeSignature, "signature"],
  [LXMScoreCommandEnum.SetSectionLabel, "label"],
]);

/** 在隔离文档上预验证全部候选；任何失败都不会先提交前面的表单组。 */
export const prepareSettingsSubmission = (
  document: ILXMDocument,
  value: ScoreSettingsDraft,
  initial: ScoreSettingsDraft,
  measureId?: string,
  group?: SettingsGroup,
):
  | {
      ok: true;
      commands: { command: ILXMScoreCommand; group: SettingsGroup }[];
    }
  | { ok: false; issue: SettingsIssue } => {
  if (
    (!group || group === "label") &&
    value.label !== initial.label &&
    !document.score.tracks[0]!.measures.some(
      (measure) => measure.id === measureId,
    )
  )
    return {
      ok: false,
      issue: {
        group: "label",
        message: "段落标记的原目标小节已失效，请重新选择。",
      },
    };
  let planned = document;
  const commands = planSettingsCommands(
    document,
    value,
    initial,
    measureId,
    group,
  ).map((command) => ({ command, group: commandGroups.get(command.type)! }));
  for (const entry of commands) {
    const result = applyScoreCommand(planned, entry.command);
    if (!result.ok)
      return {
        ok: false,
        issue: { group: entry.group, message: result.message },
      };
    planned = result.document;
  }
  return { ok: true, commands };
};

/** 只刷新成功的组；其他原本改动过的字段保留原文，干净字段跟随真实文档。 */
export const rebaseSettingsDraft = (
  value: ScoreSettingsDraft,
  initial: ScoreSettingsDraft,
  fresh: ScoreSettingsDraft,
  applied: readonly SettingsGroup[],
): ScoreSettingsDraft => {
  const next = { ...fresh };
  for (const group of Object.keys(settingsKeys) as SettingsGroup[])
    if (!applied.includes(group))
      for (const key of settingsKeys[group])
        if (value[key] !== initial[key])
          Object.assign(next, { [key]: value[key] });
  return next;
};

/** 每条命令前后检查真实版本，宿主同步重入时停止，不回滚其他人的修改。 */
export const submitSettingsDraft = ({
  getState,
  commit,
  value,
  initial,
  measureId,
  group,
}: {
  getState: () => EditorSessionVersion;
  commit: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  value: ScoreSettingsDraft;
  initial: ScoreSettingsDraft;
  measureId?: string;
  group?: SettingsGroup;
}): SettingsSubmissionResult => {
  let expected = captureEditorVersion(getState());
  if (!expected.document)
    return {
      status: "blocked",
      submittedGroups: [],
      issue: { group, message: "当前没有可编辑的乐谱。" },
    };
  const plan = prepareSettingsSubmission(
    expected.document,
    value,
    initial,
    measureId,
    group,
  );
  if (!plan.ok)
    return { status: "blocked", submittedGroups: [], issue: plan.issue };
  const submittedGroups: SettingsGroup[] = [];
  const stale = (): SettingsSubmissionResult => ({
    status: "stale",
    submittedGroups,
    issue: {
      group,
      message: "设置提交期间曲谱已变化，剩余草稿已保留，请重新检查。",
    },
  });
  for (const entry of plan.commands) {
    if (!sameEditorVersion(getState(), expected)) return stale();
    let result: ILXMApplyScoreCommandResult | null;
    try {
      result = commit(entry.command);
    } catch {
      return {
        status: "blocked",
        submittedGroups,
        issue: {
          group: entry.group,
          message: "设置提交失败，剩余草稿已保留。",
        },
      };
    }
    if (!result?.ok)
      return {
        status: "blocked",
        submittedGroups,
        issue: {
          group: entry.group,
          message: result && !result.ok ? result.message : "当前无法应用设置。",
        },
      };
    submittedGroups.push(entry.group);
    const current = getState();
    if (
      !sameEditorSession(current, expected) ||
      current.document !== result.document ||
      current.stateVersion !== expected.stateVersion + (result.changed ? 1 : 0)
    )
      return stale();
    expected = captureEditorVersion(current);
  }
  return {
    status: "applied",
    submittedGroups: group && !plan.commands.length ? [group] : submittedGroups,
    issue: null,
  };
};
