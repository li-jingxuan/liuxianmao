import { useState, useRef, useImperativeHandle, useEffect, useLayoutEffect, useMemo, useId, type Ref, type ReactNode, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Alert, Button } from "antd";
import { LXMScoreCommandEnum, type ILXMDocument, type ILXMApplyScoreCommandResult, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { useEditorSessionStore } from "../../../stores/editor-store";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { readScoreSettings, submitSettingsDraft, reconcileSettingsDraft, prepareSettingsSubmission, settingsGroups, settingsKeys, isSettingsGroupDirty, changeScoreSettingsField, acknowledgeScoreInfo, scoreInfoSnapshot, type ScoreSettingsDraft, type SettingsGroup, type SettingsGroupStatus } from "./score-settings-draft";
import { ScoreSettingsForm, type SettingsCopyRange, type SettingsIssues } from "./ScoreSettingsForm";
import { MeasureSettingsForm } from "./MeasureSettingsForm";
import { useEditorDraftRecords } from "../session/EditorSessionRuntime";
import type { EditorDraftRegistration } from "../session/editor-draft-coordinator";
import { captureEditorVersion, sameEditorSession, sameEditorVersion } from "../session/editor-session-version";
import { createScoreSettingsComposition } from "./score-settings-composition";
import { isEditorInputEnter } from "../shared/editor-input-enter";
import styles from "./ScoreSettingsForm.module.scss";

type SettingsFocusGroup = SettingsGroup | "copy";
export interface ScoreSettingsStatus {
  groups: Record<SettingsGroup, SettingsGroupStatus>;
  busy: boolean;
  composing: boolean;
  targetKey: string;
  generation: number;
  measureId?: string;
}
export interface ScoreSettingsController {
  dirty: boolean;
  isDirty: () => boolean;
  isComposing: () => boolean;
  apply: () => boolean;
  applyGroup: (group: SettingsGroup) => boolean;
  restoreGroup: (group: SettingsGroup) => boolean;
  readStatus: () => ScoreSettingsStatus;
  discard: () => boolean;
  focus: (group?: SettingsFocusGroup) => boolean;
  focusField: (field: "label" | "copy") => boolean;
}
const labels: Record<SettingsGroup, string> = { info: "曲谱信息", signature: "基础拍号", capo: "变调夹", label: "段落标记" };
const fields: Record<SettingsFocusGroup, string> = { info: "settings-title", signature: "settings-signature", capo: "settings-capo", label: "settings-label", copy: "settings-copy-start" };
const buildStatus = (draft: { value: ScoreSettingsDraft; initial: ScoreSettingsDraft; document: ILXMDocument; measureId?: string; sessionId: number; generation: number; conflicts: Partial<Record<SettingsGroup, string>> }, composing: boolean, busy: boolean): ScoreSettingsStatus => {
  const groups = {} as Record<SettingsGroup, SettingsGroupStatus>;
  for (const group of settingsGroups) {
    const dirty = isSettingsGroupDirty(draft.value, draft.initial, group);
    const plan = prepareSettingsSubmission(draft.document, draft.value, draft.initial, draft.measureId, group);
    const blockedReason = busy ? "正在处理设置，请稍候。" : composing ? "请先完成输入法组合输入。" : draft.conflicts[group] || (!plan.ok ? plan.issue.message : null);
    groups[group] = { dirty, canApply: dirty && !blockedReason, blockedReason };
  }
  return { groups, busy, composing, targetKey: `settings:${draft.sessionId}:${draft.measureId ?? "song"}`, generation: draft.generation, measureId: draft.measureId };
};

/** 唯一设置 owner：两个正文 Portal 和动作 Portal 共享值、版本、组合输入和提交闸门。 */
export const ScoreSettings = ({ ref, document, measureId, requestedMeasureId = measureId, songHost, measureHost, actionsHost, activeSurface, onDirty, onStatus, commit, executeTool, onFocusRequest, onOpen, guardApply, onInfoApplied, onApplySettled }: {
  ref: Ref<ScoreSettingsController>;
  document: ILXMDocument;
  measureId?: string;
  requestedMeasureId?: string;
  songHost?: HTMLElement | null;
  measureHost?: HTMLElement | null;
  actionsHost?: HTMLElement | null;
  activeSurface?: "song" | "measure" | null;
  onDirty: (dirty: boolean) => void;
  onStatus?: (status: ScoreSettingsStatus) => void;
  commit: (command: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  executeTool?: EditorCommandAdapter;
  onFocusRequest?: (group?: SettingsFocusGroup) => boolean;
  onOpen?: (group?: SettingsFocusGroup) => boolean | void;
  guardApply?: (group: SettingsGroup | undefined, identity?: EditorDraftRegistration) => boolean;
  onInfoApplied?: (document: ILXMDocument) => void;
  onApplySettled?: (group: SettingsGroup | undefined) => void;
}) => {
  const store = useEditorSessionStore();
  const ownerId = useId();
  const [compositionActive, setCompositionActive] = useState(false);
  const [composition] = useState(() => createScoreSettingsComposition(setCompositionActive));
  useEffect(() => () => composition.dispose(), [composition]);
  const fresh = (doc = document, target = requestedMeasureId, generation = 0) => {
    const value = readScoreSettings(doc, target);
    return { document: doc, sessionId: store.getState().sessionId, measureId: target, value, initial: value, conflicts: {} as Partial<Record<SettingsGroup, string>>, generation };
  };
  const [state, setState] = useState(fresh);
  const current = useRef(state);
  const publish = (next: typeof state) => { current.current = next; setState(next); };
  const [issues, setIssues] = useState<SettingsIssues>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const roots = useRef<Partial<Record<"song" | "measure" | "actions", HTMLDivElement | null>>>({});
  const lastControls = useRef<Partial<Record<SettingsFocusGroup, HTMLElement>>>({});
  const [activeGroup, setActiveGroup] = useState<SettingsFocusGroup>("info");
  const activeGroupRef = useRef(activeGroup);
  const [focusRequest, setFocusRequest] = useState<{ group: SettingsFocusGroup; sequence: number } | null>(null);
  const firstId = document.score.tracks[0]!.measures[0]!.id;
  const [copy, setCopy] = useState<SettingsCopyRange>({ start: firstId, end: firstId, after: "" });

  // 同会话外部更新保留脏字段；干净局部标记仅跟随已接受的请求。
  let rendered = state;
  if (state.sessionId !== store.getState().sessionId) {
    rendered = fresh(document, requestedMeasureId, state.generation + 1);
  } else if (state.document !== document) {
    const next = readScoreSettings(document, state.measureId);
    rendered = { ...state, document, ...reconcileSettingsDraft(state.value, state.initial, next, state.conflicts), generation: state.generation + 1 };
  }
  if (rendered.measureId !== requestedMeasureId && !isSettingsGroupDirty(rendered.value, rendered.initial, "label") && !busy) {
    const next = readScoreSettings(document, requestedMeasureId);
    rendered = { ...rendered, measureId: requestedMeasureId, value: { ...rendered.value, label: next.label }, initial: { ...rendered.initial, label: next.label }, generation: rendered.generation + 1 };
  }
  if (rendered !== state) setState(rendered);
  useLayoutEffect(() => { current.current = state; }, [state]);

  // Controller 事件总是按最新 store 校验，避免外部命令后、React effect 前的旧候选。
  const synchronize = () => {
    const snapshot = store.getState();
    let draft = current.current;
    if (snapshot.sessionId !== draft.sessionId || !snapshot.document) return null;
    if (snapshot.document !== draft.document) {
      draft = { ...draft, document: snapshot.document, ...reconcileSettingsDraft(draft.value, draft.initial, readScoreSettings(snapshot.document, draft.measureId), draft.conflicts), generation: draft.generation + 1 };
      publish(draft);
    }
    return draft;
  };
  const statusFor = (draft: typeof state) => buildStatus(draft, composition.isComposing(), busyRef.current);
  const readStatus = () => {
    const latest = synchronize();
    const status = statusFor(latest ?? current.current);
    if (!latest) for (const group of settingsGroups) status.groups[group] = { ...status.groups[group], canApply: false, blockedReason: "编辑会话已失效。" };
    return status;
  };
  const status = useMemo(() => buildStatus(rendered, compositionActive, busy), [rendered, compositionActive, busy]);
  const dirty = settingsGroups.some((group) => status.groups[group].dirty);
  const renderVersion = captureEditorVersion({ ...store.getState(), document });
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => { onStatus?.(status); }, [status, onStatus]);

  const focus = (requested?: SettingsFocusGroup) => {
    const latest = readStatus();
    const previous = activeGroupRef.current;
    const group = requested ?? (previous !== "copy" && latest.groups[previous].dirty ? previous : settingsGroups.find((item) => latest.groups[item].dirty) ?? "info");
    if (composition.isComposing() || busyRef.current) return false;
    if (onFocusRequest && !onFocusRequest(group)) return false;
    if (onOpen?.(group) === false) return false;
    activeGroupRef.current = group;
    setActiveGroup(group);
    setFocusRequest((previous) => ({ group, sequence: (previous?.sequence ?? 0) + 1 }));
    return true;
  };
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const group = focusRequest.group;
    const surface = group === "label" || group === "copy" ? "measure" : "song";
    const root = roots.current[surface];
    const previous = lastControls.current[group];
    const control = previous && root?.contains(previous) && previous.getClientRects().length ? previous : root?.querySelector<HTMLElement>(`#${fields[group]}`);
    let ancestor = control?.parentElement;
    while (ancestor && root?.contains(ancestor)) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    if (!control || !control.getClientRects().length) return;
    control.scrollIntoView({ block: "nearest" });
    control.focus({ preventScroll: true });
    setFocusRequest(null);
  }, [focusRequest, activeSurface, songHost, measureHost]);

  const clearIssues = (groups: readonly SettingsGroup[]) => setIssues((previous) => {
    const next = { ...previous };
    delete next.all;
    for (const group of groups) delete next[group];
    return next;
  });
  const update = <K extends keyof ScoreSettingsDraft>(key: K, value: ScoreSettingsDraft[K]) => {
    if (busyRef.current) return;
    const draft = synchronize();
    if (!draft || draft.value[key] === value) return;
    const group = settingsGroups.find((group) => (settingsKeys[group] as readonly string[]).includes(key))!;
    const initial = { ...draft.initial };
    if (draft.conflicts[group] && group !== "info") {
      const freshValue = readScoreSettings(draft.document, draft.measureId);
      for (const field of settingsKeys[group]) Object.assign(initial, { [field]: freshValue[field] });
    }
    const conflicts = { ...draft.conflicts };
    if (group !== "info") delete conflicts[group];
    publish({ ...draft, initial, conflicts, value: changeScoreSettingsField(draft.value, key, value), generation: draft.generation + 1 });
    clearIssues([group]);
  };
  const restoreGroup = (group: SettingsGroup) => {
    if (composition.isComposing() || busyRef.current) return false;
    const draft = synchronize();
    if (!draft) return false;
    const next = readScoreSettings(draft.document, draft.measureId);
    const value = { ...draft.value }, initial = { ...draft.initial }, conflicts = { ...draft.conflicts };
    for (const key of settingsKeys[group]) { Object.assign(value, { [key]: next[key] }); Object.assign(initial, { [key]: next[key] }); }
    delete conflicts[group];
    publish({ ...draft, value, initial, conflicts, generation: draft.generation + 1 });
    clearIssues([group]);
    return true;
  };
  const acknowledgeInfo = () => {
    if (composition.isComposing() || busyRef.current) return;
    const draft = synchronize();
    if (!draft) return;
    const result = acknowledgeScoreInfo(draft.document, draft.value, readScoreSettings(draft.document, draft.measureId));
    if (!result.ok) { setIssues((previous) => ({ ...previous, info: result.issue.message })); return; }
    const conflicts = { ...draft.conflicts };
    delete conflicts.info;
    publish({ ...draft, value: result.value, initial: result.initial, conflicts, generation: draft.generation + 1 });
    clearIssues(["info"]);
  };
  const apply = (group?: SettingsGroup): boolean => {
    if (composition.isComposing() || busyRef.current) return false;
    const draft = synchronize();
    if (!draft) return false;
    const groups = group ? [group] : settingsGroups.filter((item) => isSettingsGroupDirty(draft.value, draft.initial, item));
    const latest = statusFor(draft);
    const blocked = groups.find((item) => latest.groups[item].blockedReason);
    if (blocked) { setIssues((previous) => ({ ...previous, [blocked]: latest.groups[blocked].blockedReason! })); return false; }
    if (guardApply && !guardApply(group, draftRegistration.captureIdentity())) {
      setIssues((previous) => ({ ...previous, [group ?? "all"]: "当前交接状态不允许提交此设置组，请返回和弦编辑或重新打开曲谱信息。" }));
      onApplySettled?.(group);
      return false;
    }
    const expected = captureEditorVersion(store.getState());
    busyRef.current = true;
    setBusy(true);
    try {
      const result = submitSettingsDraft({ getState: store.getState, commit, value: draft.value, initial: draft.initial, measureId: draft.measureId, group });
      if (!sameEditorSession(store.getState(), expected)) return false;
      const nextDocument = store.getState().document;
      if (nextDocument) publish({ ...draft, document: nextDocument, ...reconcileSettingsDraft(draft.value, draft.initial, readScoreSettings(nextDocument, draft.measureId), draft.conflicts, result.submittedGroups), generation: draft.generation + 1 });
      clearIssues(result.submittedGroups);
      if (result.issue) { setIssues((previous) => ({ ...previous, [result.issue!.group ?? "all"]: result.issue!.message })); store.getState().setErrorMessage(result.issue.message); return false; }
      if (nextDocument && result.submittedGroups.includes("info")) onInfoApplied?.(nextDocument);
      store.getState().setErrorMessage(null);
      return true;
    } finally { busyRef.current = false; setBusy(false); onApplySettled?.(group); }
  };

  const copyMeasures = async () => {
    const latest = readStatus();
    if (latest.busy || latest.composing || settingsGroups.some((group) => latest.groups[group].dirty)) return;
    const expected = captureEditorVersion(store.getState());
    if (!expected.document) return;
    const draftGeneration = current.current.generation;
    const range = copy;
    const measures = expected.document.score.tracks[0]!.measures;
    const start = measures.findIndex((measure) => measure.id === range.start), end = measures.findIndex((measure) => measure.id === range.end);
    if (start < 0 || end < start || (range.after && !measures.some((measure) => measure.id === range.after))) { setIssues((previous) => ({ ...previous, copy: "复制范围或插入位置已失效，请重新选择。" })); return; }
    const command: ILXMScoreCommand = { type: LXMScoreCommandEnum.CopyMeasureRange, trackId: expected.document.score.tracks[0]!.id, sourceStartMeasureId: range.start, sourceEndMeasureId: range.end, afterMeasureId: range.after || undefined };
    busyRef.current = true;
    setBusy(true);
    try {
      if (!sameEditorVersion(store.getState(), expected)) return;
      const outcome = executeTool ? await executeTool(command) : null;
      if (!sameEditorSession(store.getState(), expected) || current.current.generation !== draftGeneration) return;
      if (outcome) {
        if (outcome.status === "applied" || outcome.status === "noop") setIssues((previous) => ({ ...previous, copy: undefined }));
        else setIssues((previous) => ({ ...previous, copy: outcome.status === "needs-impact" ? outcome.result.message : outcome.message }));
      } else {
        const result = commit(command);
        if (!sameEditorSession(store.getState(), expected)) return;
        setIssues((previous) => ({ ...previous, copy: result?.ok ? undefined : result && !result.ok ? result.message : "当前无法复制小节。" }));
      }
    } catch { if (sameEditorSession(store.getState(), expected)) setIssues((previous) => ({ ...previous, copy: "复制未完成，请重新检查范围。" })); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const draftRegistration = useEditorDraftRecords(settingsGroups.map((group) => ({
    id: `settings:${store.getState().sessionId}:${ownerId}:${group}`,
    kind: "settings" as const,
    targetKey: group === "label" ? `${state.sessionId}:${state.measureId ?? "missing"}` : String(state.sessionId),
    label: labels[group], location: group === "label" ? "选区 → 小节" : "歌曲",
    dirty: status.groups[group].dirty, composing: compositionActive && (status.groups[group].dirty || activeGroup === group), canApply: status.groups[group].canApply,
    error: status.groups[group].dirty ? issues[group] || status.groups[group].blockedReason : null, version: renderVersion,
    inputKey: `${state.generation}:${group}`,
    focus: () => focus(group), apply: ({ isCurrent }: { isCurrent: () => boolean }) => isCurrent() ? apply(group) ? "applied" as const : "blocked" as const : "stale" as const,
    discard: () => restoreGroup(group),
  })));
  const discard = () => {
    if (composition.isComposing() || busyRef.current) return false;
    const snapshot = store.getState();
    if (!snapshot.document || snapshot.sessionId !== current.current.sessionId) return false;
    draftRegistration.invalidateOwner();
    publish(fresh(snapshot.document, requestedMeasureId, current.current.generation + 1));
    setIssues({});
    return true;
  };
  useImperativeHandle(ref, () => ({ dirty, isDirty: () => settingsGroups.some((group) => readStatus().groups[group].dirty), isComposing: composition.isComposing, apply: () => apply(), applyGroup: apply, restoreGroup, readStatus, discard, focus, focusField: focus }));

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const group = (event.target as HTMLElement).closest<HTMLElement>("[data-settings-group]")?.dataset.settingsGroup as SettingsFocusGroup | undefined;
    if (!group) return;
    lastControls.current[group] = event.target as HTMLElement;
    activeGroupRef.current = group;
    setActiveGroup(group);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (composition.isComposing()) { event.stopPropagation(); return; }
    if (!isEditorInputEnter(event)) return;
    const group = (event.target as HTMLElement).closest<HTMLElement>("[data-settings-group]")?.dataset.settingsGroup;
    if (!group) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || busyRef.current || !settingsGroups.includes(group as SettingsGroup)) return;
    if (readStatus().groups[group as SettingsGroup].dirty) apply(group as SettingsGroup);
  };
  const surface = (name: "song" | "measure" | "actions", children: ReactNode) => <div
    ref={(node) => { roots.current[name] = node; }}
    data-settings-surface={name}
    onCompositionStart={composition.start} onCompositionEnd={composition.end}
    onKeyDownCapture={(event) => composition.observeKey(event.nativeEvent)}
    onKeyDown={handleKeyDown}
    onFocusCapture={handleFocusCapture}
  >{children}</div>;
  const props = { document, value: rendered.value, composing: compositionActive, busy, issues, groups: status.groups, inlineActions: !actionsHost, onChange: update, onApply: apply, onRestore: restoreGroup };
  const song = surface("song", <ScoreSettingsForm {...props} measureId={requestedMeasureId} onEditMeasure={() => focus("label")} infoConflict={rendered.conflicts.info ? { previous: scoreInfoSnapshot(rendered.initial), current: scoreInfoSnapshot(readScoreSettings(document, rendered.measureId)) } : undefined} onAcknowledgeInfo={acknowledgeInfo} />);
  const measure = surface("measure", <MeasureSettingsForm {...props} measureId={rendered.measureId} selectedMeasureId={requestedMeasureId} dirty={dirty} copy={copy} onCopyChange={(next) => { if (!busyRef.current) { setCopy(next); setIssues((previous) => ({ ...previous, copy: undefined })); } }} onCopy={copyMeasures} />);
  const portalMode = songHost !== undefined || measureHost !== undefined;
  const actionGroup: SettingsGroup = activeSurface === "measure" ? "label" : activeGroup === "copy" || activeGroup === "label" ? "info" : activeGroup;
  const actionStatus = status.groups[actionGroup];
  const copyAction = activeSurface === "measure" && activeGroup === "copy";
  const measures = document.score.tracks[0]!.measures;
  const copyStart = measures.findIndex((measure) => measure.id === copy.start);
  const copyEnd = measures.findIndex((measure) => measure.id === copy.end);
  const canCopy = !dirty && !busy && !compositionActive && copyStart >= 0 && copyEnd >= copyStart && (!copy.after || measures.some((measure) => measure.id === copy.after));
  const actions = activeSurface && actionsHost ? createPortal(surface("actions", <div className={styles.footer} aria-label="设置操作">
    {copyAction ? <>
      <div className={styles.actionState} role="status"><strong>范围复制</strong><span>{canCopy ? "可复制所选小节" : "请检查复制范围与未应用设置"}</span></div>
      {issues.copy && <Alert type="error" title={issues.copy} />}
      {dirty && <p className={styles.footerHint}>请先处理未应用的设置，再复制小节。</p>}
      <div className={styles.footerActions}><Button type="primary" disabled={!canCopy} loading={busy} onClick={copyMeasures}>复制小节范围</Button></div>
    </> : <>
    <div className={styles.actionState} role="status"><strong>{labels[actionGroup]}</strong><span>{actionStatus.dirty ? "有未应用的修改" : "已应用到曲谱"}</span></div>
    {(issues[actionGroup] || actionStatus.blockedReason) && <Alert type="error" title={issues[actionGroup] || actionStatus.blockedReason} />}
    <div className={styles.footerActions}>
      <Button disabled={!actionStatus.dirty || busy || compositionActive} onClick={() => restoreGroup(actionGroup)}>恢复本组</Button>
      <Button type="primary" disabled={!actionStatus.canApply} onClick={() => apply(actionGroup)}>应用{labels[actionGroup]}</Button>
    </div>
    </>}
    {settingsGroups.some((group) => (copyAction || group !== actionGroup) && status.groups[group].dirty) && <div className={styles.otherGroups}>{settingsGroups.filter((group) => (copyAction || group !== actionGroup) && status.groups[group].dirty).map((group) => <Button key={group} type="link" onClick={() => focus(group)}>{labels[group]}未应用</Button>)}</div>}
  </div>), actionsHost) : null;
  return <>{portalMode ? <>{songHost && createPortal(song, songHost)}{measureHost && createPortal(measure, measureHost)}</> : <>{song}{measure}</>}{actions}</>;
};
