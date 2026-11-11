import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMDocument,
  type ILXMScoreCommand,
  type ILXMKeySignature,
  type ILXMApplyScoreCommandResult,
  SCORE_TONALITY_NAMESPACE,
  semanticJsonEqual,
  keySignatureForTonality,
  validateScoreTonality,
  type ScoreTonalityV1,
} from "@liuxianmao/lxm-editor";
import {
  captureEditorVersion,
  sameEditorSession,
  sameEditorVersion,
  type EditorSessionVersion,
} from "../session/editor-session-version";

export type TonalityWriteIntent = { kind: "preserve" } | { kind: "delete" } | { kind: "set"; value: ScoreTonalityV1 };
export interface TonalityNamespaceSnapshot { namespacePresent: boolean; namespaceRaw: unknown }
export interface ScoreSettingsDraft {
  title: string;
  arranger: string;
  keySignature: ILXMKeySignature | null;
  tonalityIntent: TonalityWriteIntent;
  tonalityNamespace: TonalityNamespaceSnapshot;
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
    tonalityIntent: { kind: "preserve" },
    tonalityNamespace: {
      namespacePresent: Object.hasOwn(document.score.meta, SCORE_TONALITY_NAMESPACE),
      namespaceRaw: structuredClone(document.score.meta[SCORE_TONALITY_NAMESPACE]),
    },
    capo: String(track.capo),
    signature: `${time.numerator}/${time.denominator}`,
    label: track.measures.find((m) => m.id === measureId)?.sectionLabel ?? "",
  };
};
export type SettingsGroup = "info" | "capo" | "signature" | "label";
export const settingsKeys = {
  info: ["title", "arranger", "keySignature", "tonalityIntent", "tonalityNamespace"],
  capo: ["capo"],
  signature: ["signature"],
  label: ["label"],
} as const;
export const settingsGroups = Object.keys(settingsKeys) as SettingsGroup[];
export const effectiveTonalityNamespace = (value: ScoreSettingsDraft): TonalityNamespaceSnapshot =>
  value.tonalityIntent.kind === "preserve" ? value.tonalityNamespace : value.tonalityIntent.kind === "delete"
    ? { namespacePresent: false, namespaceRaw: undefined }
    : { namespacePresent: true, namespaceRaw: value.tonalityIntent.value };
export const scoreInfoSnapshot = (value: ScoreSettingsDraft) => ({
  title: value.title, arranger: value.arranger, keySignature: value.keySignature,
  ...effectiveTonalityNamespace(value),
});
export const isSettingsGroupDirty = (
  value: ScoreSettingsDraft,
  initial: ScoreSettingsDraft,
  group: SettingsGroup,
) => group === "info" ? !semanticJsonEqual(scoreInfoSnapshot(value), scoreInfoSnapshot(initial)) : settingsKeys[group].some((key) => value[key] !== initial[key]);

/** A set intent always derives digital 1 in the same local update. */
export const changeScoreSettingsField = <K extends keyof ScoreSettingsDraft>(value: ScoreSettingsDraft, key: K, next: ScoreSettingsDraft[K]): ScoreSettingsDraft => {
  const result = { ...value, [key]: next };
  if (key === "tonalityIntent" && result.tonalityIntent.kind === "set" && !validateScoreTonality(result.tonalityIntent.value))
    result.keySignature = keySignatureForTonality(result.tonalityIntent.value);
  return result;
};

export interface SettingsGroupStatus {
  dirty: boolean;
  canApply: boolean;
  blockedReason: string | null;
}

/** 外部更新只接纳干净字段；同字段冲突保留旧基线，直到明确恢复或重新编辑。 */
export const reconcileSettingsDraft = (
  value: ScoreSettingsDraft,
  initial: ScoreSettingsDraft,
  fresh: ScoreSettingsDraft,
  conflicts: Partial<Record<SettingsGroup, string>> = {},
  applied: readonly SettingsGroup[] = [],
) => {
  const nextValue = rebaseSettingsDraft(value, initial, fresh, applied);
  const nextInitial = { ...fresh };
  const nextConflicts = { ...conflicts };
  for (const group of settingsGroups) {
    if (applied.includes(group)) {
      delete nextConflicts[group];
      continue;
    }
    if (group === "info") {
      if (isSettingsGroupDirty(value, initial, "info") && !semanticJsonEqual(scoreInfoSnapshot(initial), scoreInfoSnapshot(fresh)))
        nextConflicts.info = "曲谱信息已发生变化，整组输入与旧基线已保留。请加载已应用信息，或核对并保留整组输入。";
      if (nextConflicts.info) for (const key of settingsKeys.info) {
        Object.assign(nextInitial, { [key]: initial[key] });
        Object.assign(nextValue, { [key]: value[key] });
      }
      continue;
    }
    for (const key of settingsKeys[group]) {
      if (value[key] === initial[key]) continue;
      if (fresh[key] !== initial[key])
        nextConflicts[group] = "此组已应用内容发生变化，原输入已保留。请恢复本组或核对后修改输入。";
      if (nextConflicts[group]) Object.assign(nextInitial, { [key]: initial[key] });
    }
  }
  return { value: nextValue, initial: nextInitial, conflicts: nextConflicts };
};
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
    isSettingsGroupDirty(value, initial, g);
  const commands: ILXMScoreCommand[] = [];
  if (changed("info"))
    commands.push({
      type: LXMScoreCommandEnum.SetScoreInfo,
      title: value.title,
      arranger: value.arranger,
      keySignature: value.keySignature,
      tonality: value.tonalityIntent.kind === "preserve" ? undefined : value.tonalityIntent.kind === "delete" ? null : value.tonalityIntent.value,
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
  [LXMScoreCommandEnum.SetScoreInfo, "info"],
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
  if ((!group || group === "info") && isSettingsGroupDirty(value, initial, "info") && !semanticJsonEqual(scoreInfoSnapshot(initial), scoreInfoSnapshot(readScoreSettings(document, measureId))))
    return { ok: false, issue: { group: "info", message: "曲谱信息基线已变化，请加载已应用信息或核对整组后重试。" } };
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
        if (group === "info" ? isSettingsGroupDirty(value, initial, group) : value[key] !== initial[key])
          Object.assign(next, { [key]: value[key] });
  return next;
};

/** Explicit acknowledgement binds to the supplied latest snapshot and keeps the entire intended group. */
export const acknowledgeScoreInfo = (document: ILXMDocument, value: ScoreSettingsDraft, fresh: ScoreSettingsDraft):
  | { ok: true; value: ScoreSettingsDraft; initial: ScoreSettingsDraft }
  | { ok: false; issue: SettingsIssue } => {
  let next = value;
  if (value.tonalityIntent.kind === "preserve" && !semanticJsonEqual(value.tonalityNamespace, fresh.tonalityNamespace)) {
    const old = value.tonalityNamespace;
    if (old.namespacePresent && validateScoreTonality(old.namespaceRaw))
      return { ok: false, issue: { group: "info", message: "保留的调性资料无效或版本未知，请先显式修复或清除。" } };
    next = { ...value, tonalityIntent: old.namespacePresent ? { kind: "set", value: structuredClone(old.namespaceRaw) as ScoreTonalityV1 } : { kind: "delete" } };
  }
  const initial = { ...value };
  for (const key of settingsKeys.info) Object.assign(initial, { [key]: fresh[key] });
  const plan = prepareSettingsSubmission(document, next, initial, undefined, "info");
  return plan.ok ? { ok: true, value: next, initial } : plan;
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
