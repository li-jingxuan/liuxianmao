"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Modal, Tooltip } from "antd";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getMissingRepeatEndingPasses, type ILXMRepeatEnding, type ILXMRepeatEndingGroup, type ILXMTrack } from "@liuxianmao/lxm-editor";
import { EditorModalGuard } from "../session/EditorModalGuard";
import { useEditorDraftRecords } from "../session/EditorSessionRuntime";
import type { EditorDraftOwner, EditorDraftRecord } from "../session/editor-draft-coordinator";
import type { EditorSessionVersion } from "../session/editor-session-version";
import { createRepeatEndingDraftModel, findRepeatEndingDraftIssue, measureLabel, repeatPasses } from "./repeat-ending-draft";
import styles from "./RepeatEndingInspector.module.scss";

export interface RepeatEndingInspectorRequest {
  mode?: "section" | "insert";
  endingId?: string;
  groupId?: string;
  pass?: number;
  restoreFocus?: () => void;
}

export interface RepeatEndingInspectorProps {
  track: ILXMTrack;
  measureIds: readonly string[];
  request?: RepeatEndingInspectorRequest;
  onRequestHandled?: (request: RepeatEndingInspectorRequest) => void;
  version?: EditorSessionVersion;
  disabled?: boolean;
  onRevealMeasure: (measureId: string) => void;
  onSelectEnding: (ending: ILXMRepeatEnding) => void;
  onPreviewChange: (group: ILXMRepeatEndingGroup | undefined) => void;
  onApply: (group: ILXMRepeatEndingGroup, selectedEnding: ILXMRepeatEnding | undefined, version?: EditorSessionVersion, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
  onDeleteGroup: (groupId: string, version?: EditorSessionVersion, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
}

interface Draft {
  group: ILXMRepeatEndingGroup;
  selection: readonly string[];
  selectedEndingId?: string;
  version?: EditorSessionVersion;
  dirty: boolean;
}

type Confirmation =
  | { kind: "switch"; group: ILXMRepeatEndingGroup }
  | { kind: "deleteRoom"; row: number }
  | { kind: "deleteGroup" };

const passesLabel = (passes: readonly number[]) => `第 ${passes.join("、")} 遍`;
const emptyGroups: readonly ILXMRepeatEndingGroup[] = [];

function RepeatEndingHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    // Tooltip 和标题按钮的焦点都属于当前表单。先消费 Esc 收起说明，保留整组草稿。
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", dismiss, true);
    return () => window.removeEventListener("keydown", dismiss, true);
  }, [open]);
  return <Tooltip title="每遍先弹共享段，再弹勾选该遍的房子。总遍数含首遍。最后从结尾区后的共同出口继续。"
    trigger={["hover", "focus"]} placement="top" open={open} onOpenChange={setOpen}
    getPopupContainer={(trigger) => trigger.closest<HTMLElement>('[role="dialog"]') ?? trigger.parentElement!}>
    <button type="button" aria-label="反复房子说明" className={styles.help}><QuestionCircleOutlined aria-hidden="true" /></button>
  </Tooltip>;
}

export function RepeatEndingInspector({
  track, measureIds, request, onRequestHandled, version, disabled = false, onRevealMeasure, onSelectEnding, onPreviewChange, onApply, onDeleteGroup,
}: RepeatEndingInspectorProps) {
  const titleId = useId();
  const errorId = useId();
  const detailsId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const modalRoot = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | SVGElement | null>(null);
  const restoreEntry = useRef<(() => void) | undefined>(undefined);
  const preferredFocus = useRef<string | undefined>(undefined);
  const consumed = useRef<RepeatEndingInspectorRequest | undefined>(undefined);
  const committing = useRef(false);
  const mounted = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const groups = track.repeatEndingGroups ?? emptyGroups;
  const { measures } = track;
  const model = useMemo(() => createRepeatEndingDraftModel(track), [track]);
  const { indexOf, range } = model;
  const group = draft?.group;
  // 草稿绑定打开时的乐谱快照。外部宿主、撤销或换谱改变快照后，停用表单并说明怎样恢复。
  const isStale = !!draft?.version && (draft.version.document !== version?.document ||
    draft.version.sessionVersion !== version?.sessionVersion);
  const issue = !isStale && group ? findRepeatEndingDraftIssue(track, group, model) : undefined;
  const missing = group ? getMissingRepeatEndingPasses(group) : [];
  const blocked = disabled || busy || isStale;

  function resetForm() {
    setDraft(null);
    setConfirmation(null);
    setDetailsOpen(false);
    setError(undefined);
  }

  const notifications = useRef(onPreviewChange);
  useLayoutEffect(() => { notifications.current = onPreviewChange; });
  // 表单打开期间只向编辑态布局发送快照。取消、换谱、隐藏侧栏均会撤掉所有虚线预览。
  const preview = disabled || isStale || confirmation?.kind === "deleteGroup" || (group?.id && !draft?.dirty) ? undefined : group;
  useLayoutEffect(() => { notifications.current(preview); }, [preview]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; notifications.current(undefined); };
  }, []);

  const records = useMemo<readonly EditorDraftRecord[]>(() => {
    if (!draft?.version || !draft.dirty) return [];
    const target = draft.group.endings[0]?.startMeasureId ?? draft.group.sharedEndMeasureId;
    return [{
      id: `repeat-ending:${titleId}`, kind: "repeatEnding", label: "反复房子编辑",
      targetKey: draft.group.id || target, location: indexOf(target) >= 0 ? measureLabel(indexOf(target)) : undefined,
      dirty: true, composing: false, canApply: false, error: "请在反复房子表单应用。", version: draft.version,
      focus: () => {
        const control = modalRoot.current?.querySelector<HTMLElement>("select, button");
        control?.focus({ preventScroll: true });
        return !!control;
      },
      discard: () => {
        if (committing.current) return false;
        resetForm();
        return true;
      },
      apply: () => "blocked",
    }];
  }, [draft, indexOf, titleId]);
  const registration = useEditorDraftRecords(records);

  function open(next: ILXMRepeatEndingGroup | undefined, focusEndingId?: string, restore?: () => void) {
    if (!next || blocked || draft) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    restoreEntry.current = restore;
    registration.invalidateOwner();
    const start = Math.min(...measureIds.map(indexOf));
    const end = Math.max(...measureIds.map(indexOf));
    const selectedEndingId = focusEndingId ?? next.endings.find((ending) =>
      ending.id && start >= indexOf(ending.startMeasureId) && end <= indexOf(ending.endMeasureId))?.id;
    const row = next.endings.findIndex(({ id }) => id === selectedEndingId);
    preferredFocus.current = row >= 0 ? `[data-room-row="${row}"][name="startMeasureId"]` : "select";
    setDraft({ group: next, selection: [...measureIds], selectedEndingId, version, dirty: !!next.id && next.endings.some(({ id }) => !id) });
    if (row >= 0) onSelectEnding(next.endings[row]!);
    else onRevealMeasure(next.endings.at(-1)?.startMeasureId ?? next.sharedEndMeasureId);
  }

  useLayoutEffect(() => {
    if (!request || consumed.current === request || blocked) return;
    // 书签、谱面、试听修复和面板入口共用整组草稿。等父级侧栏导航完成再消费请求。
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      consumed.current = request;
      const source = groups.find((item) => item.id === request.groupId || item.endings.some(({ id }) => id === request.endingId));
      if (request.mode === "section" && !source) heading.current?.focus();
      else open(model.create(measureIds, source?.id, request.pass), request.endingId, request.restoreFocus);
      onRequestHandled?.(request);
    });
    return () => { current = false; };
  });

  function update(next: ILXMRepeatEndingGroup, reveal?: string) {
    if (!draft) return;
    setDraft({ ...draft, group: next, dirty: true });
    setError(undefined);
    if (reveal) onRevealMeasure(reveal);
  }

  function switchGroup(next: ILXMRepeatEndingGroup) {
    if (!draft) return;
    registration.invalidateOwner();
    setDraft({ ...draft, group: next, selectedEndingId: undefined, dirty: false });
    setConfirmation(null);
    setError(undefined);
    onRevealMeasure(next.sharedEndMeasureId);
    preferredFocus.current = '[name="group"]';
  }

  function updateEnding(row: number, next: ILXMRepeatEnding, reveal?: string) {
    if (!group) return;
    update({ ...group, endings: group.endings.map((ending, index) => index === row ? next : ending) }, reveal);
  }

  function close() {
    registration.invalidateOwner();
    resetForm();
  }

  function cancel() {
    if (committing.current) return;
    if (confirmation) {
      preferredFocus.current = confirmation.kind === "switch" ? '[name="group"]' : confirmation.kind === "deleteGroup"
        ? "[data-delete-group]" : `[data-delete-room="${confirmation.row}"]`;
      setConfirmation(null);
    } else close();
  }

  async function commit(operation: (owner: EditorDraftOwner) => boolean | Promise<boolean>) {
    if (blocked || committing.current) return;
    const identity = registration.captureIdentity();
    committing.current = true;
    setBusy(true);
    setError(undefined);
    let success = false;
    try { success = await operation(identity.owner); }
    catch { /* 提交失败时保留草稿和确认状态，允许重试。 */ }
    finally { committing.current = false; }
    if (!mounted.current || !registration.isCurrent(identity)) return;
    setBusy(false);
    if (success) close();
    else setError("未能提交反复房子，请检查范围后重试。");
  }

  function focusPreferred() {
    if (!preferredFocus.current) return;
    const control = modalRoot.current?.querySelector<HTMLElement>(preferredFocus.current);
    if (!control?.getClientRects().length) return;
    preferredFocus.current = undefined;
    control.focus({ preventScroll: true });
  }
  useLayoutEffect(focusPreferred);

  function submit() {
    if (!draft || !group || blocked) return;
    if (confirmation?.kind === "switch") { switchGroup(confirmation.group); return; }
    if (confirmation?.kind === "deleteRoom") {
      update({ ...group, endings: group.endings.filter((_, index) => index !== confirmation.row) });
      preferredFocus.current = '[name="add"]';
      setConfirmation(null);
      return;
    }
    if (confirmation?.kind === "deleteGroup") { void commit((owner) => onDeleteGroup(group.id, draft.version, owner)); return; }
    if (issue) {
      modalRoot.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    // 所有房子（包括新增、改遍次和从草稿移除）与共享边界使用同一条命令落谱，撤销只产生一步。
    const selected = group.endings.find(({ id }) => id === draft.selectedEndingId) ??
      group.endings.find(({ id }) => !id) ?? group.endings[0];
    const next = (!draft.dirty && groups.find(({ id }) => id === group.id)) || {
      ...group, endings: [...group.endings].sort((a, b) => indexOf(a.startMeasureId) - indexOf(b.startMeasureId)),
    };
    void commit((owner) => onApply(next, selected, draft.version, owner));
  }

  const invalid = (field: string, row?: number, pass?: number) => {
    const active = issue && issue.row === row && (issue.fields as readonly string[]).includes(field) &&
      (issue.row === undefined || !issue.pass || issue.pass === pass);
    return active ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};
  };
  const field = (name: string, fieldName: "startMeasureId" | "sharedEndMeasureId" | "endMeasureId", value: string, change: (id: string) => void, row?: number) => (
    <label className={styles.field}>{name}
      <select name={fieldName} data-room-row={row} value={value} disabled={blocked} {...invalid(fieldName, row)} onChange={(event) => change(event.target.value)}>
        {indexOf(value) < 0 && <option value={value}>请选择小节</option>}
        {measures.map(({ id }, index) => <option key={id} value={id}>{measureLabel(index)}</option>)}
      </select>
    </label>
  );
  const title = confirmation?.kind === "switch" ? "切换反复组" : confirmation?.kind === "deleteRoom" ? `删除房子 ${confirmation.row + 1}`
    : confirmation?.kind === "deleteGroup" ? "删除反复组" : group?.id ? "编辑反复房子" : "添加反复房子";
  const deletingPasses = confirmation?.kind === "deleteRoom" && group ? group.endings[confirmation.row]!.passes.filter((pass) =>
    pass <= group.passCount && !group.endings.some((ending, index) => index !== confirmation.row && ending.passes.includes(pass))) : [];
  const exit = group && indexOf(group.endMeasureId) + 1;
  const exitLabel = exit !== undefined && measures[exit] ? measureLabel(exit) : "曲谱末";

  return <section className={styles.inspector} aria-labelledby={titleId} data-repeat-ending-inspector>
    <div className={styles.heading}>
      <h3 id={titleId} ref={heading} tabIndex={-1}>反复房子</h3>
      <Button size="small" disabled={blocked || measures.length < 2} onClick={() => open(model.create(measureIds))}>插入反复房子</Button>
    </div>
    {groups.map((item) => <div key={item.id} className={styles.group}>
      <div className={styles.heading}>
        <strong>反复组 · {range(item.startMeasureId, item.endMeasureId)}</strong>
        <Button size="small" disabled={blocked} onClick={() => open(model.create(measureIds, item.id))}>编辑反复组</Button>
      </div>
      {item.endings.map((ending) => <div key={ending.id} className={styles.heading}>
        <span>{passesLabel(ending.passes)} · {range(ending.startMeasureId, ending.endMeasureId)}</span>
        <Button size="small" disabled={blocked} onClick={() => open(model.create(measureIds, item.id), ending.id)}>编辑</Button>
      </div>)}
      {getMissingRepeatEndingPasses(item).map((pass) => <div key={pass} className={styles.heading}>
        <span className={styles.warning}>第 {pass} 遍没有反复房子</span>
        <Button size="small" disabled={blocked} onClick={() => open(model.create(measureIds, item.id, pass))}>补第 {pass} 遍</Button>
      </div>)}
    </div>)}
    <Modal open={!!draft} centered width={confirmation ? 440 : 700} keyboard={false} mask={{ closable: false }}
      title={<span className={styles.title}>{title}{!confirmation && <RepeatEndingHelp />}</span>}
      closable={!busy} destroyOnHidden focusable={{ focusTriggerAfterClose: false }}
      onCancel={cancel} afterOpenChange={(visible) => {
        if (visible) focusPreferred();
        else {
          const trigger = restoreFocus.current;
          const entry = restoreEntry.current;
          restoreFocus.current = null;
          restoreEntry.current = undefined;
          // React 协调器异步解除背景 inert。动画结束后让两帧，再从最新谱面解析跨行对象。
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (entry) entry();
            else (trigger?.isConnected && trigger !== document.body ? trigger : heading.current)?.focus({ preventScroll: true });
          }));
        }
      }}
      footer={null} modalRender={(content) => <EditorModalGuard ref={modalRoot} dismissable busy={busy} onDismiss={cancel}>{content}</EditorModalGuard>}>
      {draft && group && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {confirmation ? <p className={styles.hint}>{confirmation.kind === "switch" ? "切换时将放弃当前反复组尚未应用的修改。"
          : confirmation.kind === "deleteGroup" ? "确认后移除整个显式反复组。这段改按谱面上的普通反复线演奏。"
            : deletingPasses.length ? `应用后，${passesLabel(deletingPasses)}将缺房，播完共享段后暂停。你可以在应用前重新分配遍次。`
              : "应用后，此房子的括线会从谱面移除。"}</p> : <>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.full}`}>所属反复组
              <select name="group" value={group.id} disabled={blocked} {...invalid("group")} onChange={(event) => {
                const next = model.create(draft.selection, event.target.value);
                if (!next) return;
                if (draft.dirty) { preferredFocus.current = "[data-cancel]"; setConfirmation({ kind: "switch", group: next }); }
                else switchGroup(next);
              }}>
                <option value="">新建反复组</option>
                {groups.map((item) => <option key={item.id} value={item.id}>{range(item.startMeasureId, item.endMeasureId)}</option>)}
              </select>
            </label>
            {field("反复起点", "startMeasureId", group.startMeasureId, (id) => update({ ...group, startMeasureId: id }, id))}
            {field("共享段末小节", "sharedEndMeasureId", group.sharedEndMeasureId, (id) => update({ ...group, sharedEndMeasureId: id }, id))}
            {field("结尾区末小节", "endMeasureId", group.endMeasureId, (id) => update({ ...group, endMeasureId: id }, id))}
            <label className={styles.field}>总遍数<select name="passCount" value={group.passCount} disabled={blocked} {...invalid("passCount")}
              onChange={(event) => update({ ...group, passCount: Number(event.target.value) })}>
              <option value={2}>2 遍</option><option value={3}>3 遍</option>
            </select></label>
          </div>
          <section className={styles.rooms} aria-label="反复房子">
            <div className={styles.heading}><h3>反复房子</h3>
              <Button size="small" name="add" disabled={blocked} {...invalid("add")} onClick={() => {
                const next = model.addEnding(group);
                preferredFocus.current = `[data-room-row="${group.endings.length}"][name="startMeasureId"]`;
                update(next, next.endings.at(-1)!.startMeasureId);
              }}>添加房子</Button>
            </div>
            {group.endings.map((ending, row) => <div key={ending.id || `draft-${row}`} className={styles.room} role="group" aria-label={`房子 ${row + 1}`}>
              <strong>房子 {row + 1}</strong>
              {field("起始小节", "startMeasureId", ending.startMeasureId, (id) => updateEnding(row, { ...ending, startMeasureId: id }, id), row)}
              {field("结束小节", "endMeasureId", ending.endMeasureId, (id) => updateEnding(row, { ...ending, endMeasureId: id }, id), row)}
              <fieldset className={styles.passes} disabled={blocked}><legend>演奏遍次</legend><div>
                {[1, 2, 3].filter((pass) => pass <= group.passCount || ending.passes.includes(pass)).map((pass) => <label key={pass}>
                  <input type="checkbox" checked={ending.passes.includes(pass)} {...invalid("passes", row, pass)} onChange={(event) => updateEnding(row, {
                    ...ending, passes: event.target.checked ? [...ending.passes, pass].sort((a, b) => a - b) : ending.passes.filter((value) => value !== pass),
                  })} />第 {pass} 遍
                </label>)}
              </div></fieldset>
              <Button danger size="small" type="text" aria-label={`删除房子 ${row + 1}`} data-delete-room={row} disabled={blocked} onClick={() => {
                preferredFocus.current = "[data-cancel]";
                setConfirmation({ kind: "deleteRoom", row });
              }}>删除</Button>
            </div>)}
          </section>
          {isStale ? null : issue ? <p id={errorId} className={styles.issue} role="alert">{issue.row === undefined ? "" : `房子 ${issue.row + 1}：`}{issue.message}</p> :
            <section className={styles.preview} aria-label="演奏预览">
              <div className={styles.heading}>
                <p aria-live="polite" className={missing.length ? styles.warning : undefined}>{missing.length
                  ? `${passesLabel(missing)}还没选房子，可稍后补` : `${group.passCount} 遍 · ${group.endings.length} 个房子`}</p>
                <Button size="small" aria-controls={detailsId} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
                  {detailsOpen ? "收起演奏详情" : "展开演奏详情"}
                </Button>
              </div>
              {detailsOpen && <div id={detailsId} className={styles.details}>
                <p><strong>共享段</strong> {range(group.startMeasureId, group.sharedEndMeasureId)}{"\u3000"}<strong>结尾区</strong> {range(measures[indexOf(group.sharedEndMeasureId) + 1]!.id, group.endMeasureId)}{"\u3000"}<strong>共同出口</strong> {exitLabel}</p>
                {repeatPasses(group.passCount).map((pass) => {
                  const ending = group.endings.find(({ passes }) => passes.includes(pass));
                  return <p key={pass}>第 {pass} 遍{missing.some((value) => value < pass) && "（补房后）"}{"\u3000"}{range(group.startMeasureId, group.sharedEndMeasureId)} → {ending
                    ? `${range(ending.startMeasureId, ending.endMeasureId)} → ${pass < group.passCount ? `回到${measureLabel(indexOf(group.startMeasureId))}` : exitLabel}`
                    : "缺房，播完共享段暂停"}</p>;
                })}
                {model.unusedRanges(group).length > 0 && <p className={styles.warning}>未被任何遍次演奏的小节{"\u3000"}{model.unusedRanges(group).join("、")}</p>}
              </div>}
            </section>}
        </>}
        {isStale ? <p role="alert" className={styles.issue}>谱面已更新。请取消并重新打开反复房子设置。</p>
          : error && <p role="alert" className={styles.issue}>{error}</p>}
        <div className={styles.actions}>
          {!confirmation && group.id && <Button danger type="text" data-delete-group disabled={blocked} onClick={() => {
            preferredFocus.current = "[data-cancel]";
            setConfirmation({ kind: "deleteGroup" });
          }}>删除反复组</Button>}
          <Button data-cancel disabled={busy} onClick={cancel}>取消</Button>
          <Button type="primary" htmlType="submit" loading={busy} disabled={blocked} danger={!!confirmation && confirmation.kind !== "switch"}>
            {confirmation?.kind === "switch" ? "放弃修改并切换" : confirmation?.kind === "deleteRoom" ? "从草稿移除" : confirmation?.kind === "deleteGroup" ? "确认删除" : "应用"}
          </Button>
        </div>
      </form>}
    </Modal>
  </section>;
}
