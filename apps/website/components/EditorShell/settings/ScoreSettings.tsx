import { useState, useRef, useImperativeHandle, useEffect, useLayoutEffect, useMemo, useId, useCallback, type Ref, type ReactNode, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { LXMScoreCommandEnum, type ILXMDocument, type ILXMApplyScoreCommandResult, type ILXMScoreCommand } from "@liuxianmao/lxm-editor";
import { useEditorSessionStore } from "../../../stores/editor-store";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { readScoreSettings, submitSettingsDraft, reconcileEditorSettingsDraft, prepareSettingsSubmission, settingsGroups, settingsKeys, isSettingsGroupDirty, changeScoreSettingsField, acknowledgeScoreInfo, type ScoreSettingsDraft, type SettingsGroup, type SettingsGroupStatus } from "./score-settings-draft";
import { ScoreSettingsForm, type SettingsCopyRange, type SettingsIssues } from "./ScoreSettingsForm";
import { MeasureSettingsForm } from "./MeasureSettingsForm";
import { useEditorDraftRecords } from "../session/EditorSessionRuntime";
import type { EditorDraftRegistration } from "../session/editor-draft-coordinator";
import { captureEditorVersion, sameEditorSession, sameEditorVersion } from "../session/editor-session-version";
import { createScoreSettingsComposition } from "./score-settings-composition";
import { isEditorInputEnter } from "../shared/editor-input-enter";

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
  isProtectedDirty: () => boolean;
  isComposing: () => boolean;
  apply: () => boolean;
  applyGroup: (group: SettingsGroup) => boolean;
  restoreGroup: (group: SettingsGroup) => boolean;
  readStatus: () => ScoreSettingsStatus;
  discard: () => boolean;
  discardSong: () => boolean;
  focus: (group?: SettingsFocusGroup) => boolean;
  focusField: (field: "label" | "copy") => boolean;
}
const labels: Record<SettingsGroup, string> = { info: "曲谱信息", signature: "基础拍号", capo: "演奏设置", label: "段落标记" };
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
export const ScoreSettings = ({ ref, document, measureId, requestedMeasureId = measureId, selectedCopyRange, songHost, measureHost, activeSurface, onDirty, onStatus, commit, executeTool, onFocusRequest, onOpen, guardApply, onInfoApplied, onApplySettled }: {
  ref: Ref<ScoreSettingsController>;
  document: ILXMDocument;
  measureId?: string;
  requestedMeasureId?: string;
  selectedCopyRange?: Pick<SettingsCopyRange, "start" | "end"> | null;
  songHost?: HTMLElement | null;
  measureHost?: HTMLElement | null;
  actionsHost?: HTMLElement | null;
  activeSurface?: "song" | "measure" | null;
  onDirty?: (dirty: boolean) => void;
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
  const synchronizeRef = useRef<(() => typeof state | null) | null>(null);
  const statusForRef = useRef<((draft: typeof state) => ScoreSettingsStatus) | null>(null);
  const applyRef = useRef<((group?: SettingsGroup) => boolean) | null>(null);
  const publish = (next: typeof state) => { current.current = next; setState(next); };
  const [issues, setIssues] = useState<SettingsIssues>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingLabelBlur = useRef<{ sessionId: number; measureId?: string; identity: EditorDraftRegistration } | null>(null);
  const draftHandle = useRef<ReturnType<typeof useEditorDraftRecords> | null>(null);
  const roots = useRef<Partial<Record<"song" | "measure" | "actions", HTMLDivElement | null>>>({});
  const lastControls = useRef<Partial<Record<SettingsFocusGroup, HTMLElement>>>({});
  const [activeGroup, setActiveGroup] = useState<SettingsFocusGroup>("info");
  const activeGroupRef = useRef(activeGroup);
  const [focusRequest, setFocusRequest] = useState<{ group: SettingsFocusGroup; sequence: number } | null>(null);
  const firstId = document.score.tracks[0]!.measures[0]!.id;
  const defaultCopyId = selectedCopyRange === undefined ? requestedMeasureId ?? firstId : firstId;
  const copySession = store.getState().sessionId;
  const [copyState, setCopyState] = useState<{
    session: number;
    active: boolean;
    source?: Pick<SettingsCopyRange, "start" | "end">;
    after: SettingsCopyRange["after"];
  }>({ session: copySession, active: activeSurface === "measure", after: null });
  const copyActive = activeSurface === "measure";
  const copyReset = copyState.session !== copySession || copyState.active !== copyActive;
  if (copyReset) setCopyState({ session: copySession, active: copyActive, after: null });
  const copy: SettingsCopyRange = {
    ...((copyReset ? undefined : copyState.source) ?? selectedCopyRange ?? { start: defaultCopyId, end: defaultCopyId }),
    after: copyReset ? null : copyState.after,
  };

  // 同会话外部更新保留脏字段；干净局部标记仅跟随已接受的请求。
  let rendered = state;
  if (state.sessionId !== store.getState().sessionId) {
    rendered = fresh(document, requestedMeasureId, state.generation + 1);
  } else if (state.document !== document) {
    const next = readScoreSettings(document, state.measureId);
    rendered = { ...state, document, ...reconcileEditorSettingsDraft(state.value, state.initial, next, state.conflicts), generation: state.generation + 1 };
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
      draft = { ...draft, document: snapshot.document, ...reconcileEditorSettingsDraft(draft.value, draft.initial, readScoreSettings(snapshot.document, draft.measureId), draft.conflicts), generation: draft.generation + 1 };
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
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
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
    if (key !== "title" && key !== "arranger" && key !== "capo" && key !== "tempo" && key !== "showTempoMark" && key !== "label") return;
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
    if (guardApply && !guardApply(group, draftHandle.current?.captureIdentity())) {
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
      if (nextDocument) publish({ ...draft, document: nextDocument, ...reconcileEditorSettingsDraft(draft.value, draft.initial, readScoreSettings(nextDocument, draft.measureId), draft.conflicts, result.submittedGroups), generation: draft.generation + 1 });
      clearIssues(result.submittedGroups);
      if (result.issue) { setIssues((previous) => ({ ...previous, [result.issue!.group ?? "all"]: result.issue!.message })); store.getState().setErrorMessage(result.issue.message); return false; }
      if (nextDocument && result.submittedGroups.includes("info")) onInfoApplied?.(nextDocument);
      store.getState().setErrorMessage(null);
      return true;
    } finally { busyRef.current = false; setBusy(false); onApplySettled?.(group); }
  };
  // 这些函数绑定当前草稿 owner；只把最新实现放进 ref，失焦回调本身保持稳定。
  useLayoutEffect(() => {
    synchronizeRef.current = synchronize;
    statusForRef.current = statusFor;
    applyRef.current = apply;
  });

  // 段落标记失焦沿用同一个 owner 提交，不绕过冲突、目标绑定和历史校验。
  const saveLabelOnBlur = useCallback(() => {
    const draft = synchronizeRef.current?.();
    if (!draft || busyRef.current) return;
    if (composition.isComposing()) {
      if (draftHandle.current) pendingLabelBlur.current = { sessionId: draft.sessionId, measureId: draft.measureId, identity: draftHandle.current.captureIdentity() };
      return;
    }
    if (statusForRef.current?.(draft).groups.label.dirty) applyRef.current?.("label");
  }, [composition]);
  useEffect(() => {
    if (compositionActive) return;
    const pending = pendingLabelBlur.current;
    pendingLabelBlur.current = null;
    // 输入法结束后再处理失焦，旧会话或旧目标不能提交到新位置。
    if (pending && pending.sessionId === store.getState().sessionId && pending.measureId === current.current.measureId && draftHandle.current?.isCurrent(pending.identity))
      saveLabelOnBlur();
  }, [compositionActive, saveLabelOnBlur, store]);

  const copyMeasures = async () => {
    const latest = readStatus();
    if (latest.busy || latest.composing || settingsGroups.some((group) => latest.groups[group].dirty)) return;
    const expected = captureEditorVersion(store.getState());
    if (!expected.document) return;
    const draftGeneration = current.current.generation;
    const range = copy;
    const measures = expected.document.score.tracks[0]!.measures;
    const start = measures.findIndex((measure) => measure.id === range.start), end = measures.findIndex((measure) => measure.id === range.end);
    const issue = start < 0 ? "复制起始小节已失效，请重新选择。" : end < 0 ? "复制结束小节已失效，请重新选择。"
      : end < start ? "复制结束小节须在起始小节之后或与其相同。"
      : range.after && !measures.some((measure) => measure.id === range.after) ? "插入位置已失效，请重新选择。" : null;
    if (issue) { setIssues((previous) => ({ ...previous, copy: issue })); return; }
    const afterMeasureId = range.after === null ? measures.at(-1)?.id : range.after || undefined;
    const command: ILXMScoreCommand = { type: LXMScoreCommandEnum.CopyMeasureRange, trackId: expected.document.score.tracks[0]!.id, sourceStartMeasureId: range.start, sourceEndMeasureId: range.end, afterMeasureId };
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
    // 歌曲草稿保护文件操作，离开歌曲页签时仍沿用既有的放弃规则。
    fileOnly: group !== "label",
    dirty: status.groups[group].dirty,
    composing: compositionActive && (status.groups[group].dirty || activeGroup === group),
    canApply: group === "label" && status.groups[group].canApply,
    error: status.groups[group].dirty ? issues[group] || status.groups[group].blockedReason : null, version: renderVersion,
    inputKey: `${state.generation}:${group}`,
    focus: () => focus(group), apply: ({ isCurrent }: { isCurrent: () => boolean }) => isCurrent() ? apply(group) ? "applied" as const : "blocked" as const : "stale" as const,
    discard: () => restoreGroup(group),
  })));
  useLayoutEffect(() => {
    draftHandle.current = draftRegistration;
  }, [draftRegistration]);
  const discard = () => {
    if (composition.isComposing() || busyRef.current) return false;
    const snapshot = store.getState();
    if (!snapshot.document || snapshot.sessionId !== current.current.sessionId) return false;
    draftRegistration.invalidateOwner();
    publish(fresh(snapshot.document, requestedMeasureId, current.current.generation + 1));
    setIssues({});
    return true;
  };
  const discardSong = () => {
    if (composition.isComposing() || busyRef.current) return false;
    const draft = synchronize();
    if (!draft) return false;
    const next = readScoreSettings(draft.document, draft.measureId);
    const value = { ...draft.value }, initial = { ...draft.initial }, conflicts = { ...draft.conflicts };
    for (const group of ["info", "capo", "signature"] as const) {
      for (const key of settingsKeys[group]) {
        Object.assign(value, { [key]: next[key] });
        Object.assign(initial, { [key]: next[key] });
      }
      delete conflicts[group];
    }
    publish({ ...draft, value, initial, conflicts, generation: draft.generation + 1 });
    clearIssues(["info", "capo", "signature"]);
    return true;
  };
  // 收起或离开歌曲表面时放弃未应用输入；组合输入/提交期间仍沿用原闸门。
  const songWasActive = useRef(activeSurface === "song");
  useLayoutEffect(() => {
    const active = activeSurface === "song";
    if (songWasActive.current && !active && !compositionActive && !busy) {
      if (discardSong()) songWasActive.current = false;
    } else if (active) songWasActive.current = true;
  });
  useImperativeHandle(ref, () => ({ dirty, isDirty: () => settingsGroups.some((group) => readStatus().groups[group].dirty), isProtectedDirty: () => readStatus().groups.label.dirty, isComposing: composition.isComposing, apply: () => apply(), applyGroup: apply, restoreGroup, readStatus, discard, discardSong, focus, focusField: focus }));

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const group = (event.target as HTMLElement).closest<HTMLElement>("[data-settings-group]")?.dataset.settingsGroup as SettingsFocusGroup | undefined;
    if (!group) return;
    // 说明问号属于段落分组，但不能取代段落输入框成为“重新打开”后的焦点目标。
    if ((event.target as HTMLElement).matches("input, select, textarea")) {
      lastControls.current[group] = event.target as HTMLElement;
      if (group === "label") pendingLabelBlur.current = null;
    }
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
  const props = { document, value: rendered.value, composing: compositionActive, busy, issues, groups: status.groups, onChange: update, onApply: apply, onRestore: restoreGroup };
  const infoText = (value: ScoreSettingsDraft) => ({ title: value.title, arranger: value.arranger });
  const song = surface("song", <ScoreSettingsForm {...props} infoConflict={rendered.conflicts.info ? { previous: infoText(rendered.initial), current: infoText(readScoreSettings(document, rendered.measureId)) } : undefined} onAcknowledgeInfo={acknowledgeInfo} />);
  const measure = surface("measure", <MeasureSettingsForm {...props} measureId={rendered.measureId} selectedMeasureId={requestedMeasureId} dirty={dirty} copy={copy} onCopyChange={(next, field) => {
    if (busyRef.current) return;
    setCopyState((current) => field === "after" ? { ...current, after: next.after }
      : { ...current, source: { start: next.start, end: next.end } });
    setIssues((previous) => ({ ...previous, copy: undefined }));
  }} onFollowSelection={() => {
    setCopyState((current) => ({ ...current, source: undefined }));
    setIssues((previous) => ({ ...previous, copy: undefined }));
  }} onCopy={copyMeasures} onLabelBlur={saveLabelOnBlur} />);
  const portalMode = songHost !== undefined || measureHost !== undefined;
  return <>{portalMode ? <>{songHost && createPortal(song, songHost)}{measureHost && createPortal(measure, measureHost)}</> : <>{song}{measure}</>}</>;
};
