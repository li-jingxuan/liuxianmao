"use client";

import { Button, Modal } from "antd";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getMissingRepeatEndingPasses,
  inspectRepeatEndingGroups,
  suggestRepeatEndingGroup,
  type ILXMRepeatEnding,
  type ILXMRepeatEndingGroup,
  type ILXMTrack,
} from "@liuxianmao/lxm-editor";
import { EditorModalGuard } from "../session/EditorModalGuard";
import { useEditorDraftRecords } from "../session/EditorSessionRuntime";
import type { EditorDraftOwner, EditorDraftRecord } from "../session/editor-draft-coordinator";
import type { EditorSessionVersion } from "../session/editor-session-version";
import styles from "./RepeatEndingInspector.module.scss";

export interface RepeatEndingInspectorRequest {
  mode?: "section" | "insert";
  endingId?: string;
  groupId?: string;
  pass?: number;
}

export interface RepeatEndingInspectorProps {
  track: ILXMTrack;
  measureIds: readonly string[];
  request?: RepeatEndingInspectorRequest;
  onRequestHandled?: (request: RepeatEndingInspectorRequest) => void;
  version?: EditorSessionVersion;
  disabled?: boolean;
  onLocateRange: (startMeasureId: string, endMeasureId: string) => void;
  onPreviewChange: (ending: ILXMRepeatEnding | undefined) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onApply: (group: ILXMRepeatEndingGroup, ending: ILXMRepeatEnding, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
  onDelete: (endingId: string, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
  onDeleteGroup?: (groupId: string, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
}

interface Draft {
  group: ILXMRepeatEndingGroup;
  ending: ILXMRepeatEnding;
  dirty: boolean;
}

type Confirmation =
  | { kind: "switch"; draft: Draft; locate: boolean }
  | { kind: "delete"; ending: ILXMRepeatEnding }
  | { kind: "deleteGroup"; group: ILXMRepeatEndingGroup };

const label = (index: number) => `第 ${index + 1} 小节`;
const passesLabel = (passes: readonly number[]) => passes.map((pass) => `第 ${pass} 遍`).join("、");
const emptyGroups: readonly ILXMRepeatEndingGroup[] = [];

export function RepeatEndingInspector({
  track, measureIds, request, onRequestHandled, version, disabled = false, onLocateRange, onPreviewChange,
  onDirtyChange, onApply, onDelete, onDeleteGroup,
}: RepeatEndingInspectorProps) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const formTitle = useRef<HTMLHeadingElement>(null);
  const focusForm = useRef(false);
  const consumed = useRef<RepeatEndingInspectorRequest | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const currentDraft = useRef<Draft | null>(null);
  const groups = track.repeatEndingGroups ?? emptyGroups;
  const { measures } = track;
  const indexes = useMemo(() => new Map(measures.map(({ id }, index) => [id, index])), [measures]);
  const indexOf = (id: string) => indexes.get(id) ?? -1;
  const selected = measureIds.map(indexOf).filter((index) => index >= 0);
  const selectedStart = selected.length ? Math.min(...selected) : -1;
  const selectedEnd = selected.length ? Math.max(...selected) : -1;
  const range = (start: string, end: string) => start === end ? label(indexOf(start)) : `第 ${indexOf(start) + 1}–${indexOf(end) + 1} 小节`;
  const groupLabel = (group: ILXMRepeatEndingGroup) => range(group.startMeasureId, group.endMeasureId);
  const activeGroup = groups.find(({ id }) => id === draft?.group.id);
  const validDraft = draft && (!draft.group.id || activeGroup) &&
    (!draft.ending.id || activeGroup?.endings.some(({ id }) => id === draft.ending.id)) ? draft : null;

  function close() {
    focusForm.current = false;
    setDraft(null);
    setError(undefined);
    setConfirmation(null);
  }

  // 真实文件更换或撤销了当前对象时，移除对应草稿。预览和守卫由同一个有效草稿驱动。
  useLayoutEffect(() => {
    if (draft && !validDraft) close();
    currentDraft.current = validDraft;
  }, [draft, validDraft]);
  const notifications = useRef({ onPreviewChange, onDirtyChange });
  useLayoutEffect(() => { notifications.current = { onPreviewChange, onDirtyChange }; });
  const preview = disabled ? undefined : validDraft?.ending;
  const dirty = !!validDraft?.dirty;
  useLayoutEffect(() => { notifications.current.onPreviewChange(preview); }, [preview]);
  useLayoutEffect(() => { notifications.current.onDirtyChange?.(dirty); }, [dirty]);
  useLayoutEffect(() => () => {
    currentDraft.current = null;
    notifications.current.onPreviewChange(undefined);
    notifications.current.onDirtyChange?.(false);
  }, []);
  const records = useMemo<readonly EditorDraftRecord[]>(() => {
    if (!version || !validDraft?.dirty) return [];
    const draftIndex = indexes.get(validDraft.ending.startMeasureId);
    return [{
      id: `repeat-ending:${titleId}`, kind: "repeatEnding", label: "反复房子编辑",
      targetKey: validDraft.ending.id || validDraft.ending.startMeasureId,
      location: draftIndex === undefined ? undefined : label(draftIndex), dirty: true, composing: false,
      canApply: false, error: "请在反复房子表单应用。", version,
      focus: () => {
        if (!formTitle.current?.isConnected) return false;
        formTitle.current.scrollIntoView({ block: "nearest" });
        formTitle.current.focus({ preventScroll: true });
        return true;
      },
      discard: () => {
        if (committing.current || currentDraft.current !== validDraft) return false;
        close();
        return true;
      },
      apply: () => "blocked",
    }];
  }, [indexes, titleId, validDraft, version]);
  const registration = useEditorDraftRecords(records);

  function newDraft(preferred?: ILXMRepeatEndingGroup, pass?: number, forceNew = false): Draft | undefined {
    // 反向选区同样转为顺序闭区间。缺房入口在分岔小节，通过组 ID 优先填本组空位。
    const start = selectedStart < 0 ? 1 : selectedStart;
    const end = Math.max(start, selectedEnd);
    const matching = forceNew ? undefined : groups.find((group) => start > indexOf(group.sharedEndMeasureId) && end <= indexOf(group.endMeasureId));
    const preceding = forceNew || preferred || matching ? undefined : groups.find((group) =>
      start === indexOf(group.endMeasureId) + 1 && getMissingRepeatEndingPasses(group).length > 0 &&
      !groups.some((other) => other !== group && indexOf(other.startMeasureId) <= end && indexOf(other.endMeasureId) >= start),
    );
    // 紧接原结尾区新增下一房时，唯一可接续的组随草稿延展，仍在同一次应用前校验边界。
    const group = preferred ?? matching ?? (preceding && { ...preceding, endMeasureId: measures[end]!.id }) ??
      suggestRepeatEndingGroup(track, start, end);
    if (!group) return undefined;
    const first = indexOf(group.sharedEndMeasureId) + 1;
    const last = indexOf(group.endMeasureId);
    const available = (index: number) => !group.endings.some((item) => index >= indexOf(item.startMeasureId) && index <= indexOf(item.endMeasureId));
    let from = start;
    let through = end;
    if (preferred && (pass !== undefined || from < first || through > last)) {
      const free = measures.findIndex((_, index) => index >= first && index <= last && available(index));
      from = through = free < 0 ? first : free;
    }
    return {
      group, dirty: false, ending: {
        id: "", startMeasureId: measures[from]!.id, endMeasureId: measures[through]!.id,
        passes: [pass ?? getMissingRepeatEndingPasses(group)[0] ?? 1],
      },
    };
  }

  function begin(next: Draft, locate: boolean) {
    registration.invalidateOwner();
    notifications.current.onDirtyChange?.(false);
    focusForm.current = true;
    setDraft(next);
    setError(undefined);
    setConfirmation(null);
    if (locate) onLocateRange(next.ending.startMeasureId, next.ending.endMeasureId);
  }

  function open(next: Draft | undefined, locate = false) {
    if (!next || disabled || committing.current) return;
    if (next.ending.id && next.ending.id === validDraft?.ending.id) {
      formTitle.current?.focus();
    } else if (validDraft?.dirty) setConfirmation({ kind: "switch", draft: next, locate });
    else begin(next, locate);
  }

  useLayoutEffect(() => {
    if (!request || consumed.current === request || disabled || busy) return;
    // 父级同时切换选区及入口。异步消费可防止旧的请求在面板卸载后重新打开草稿。
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      consumed.current = request;
      const group = groups.find((item) => item.id === request.groupId || item.endings.some(({ id }) => id === request.endingId));
      const ending = group?.endings.find(({ id }) => id === request.endingId);
      if (group && ending) open({ group, ending, dirty: false });
      else if (request.mode === "section") heading.current?.focus();
      else if (!request.endingId) open(newDraft(group, request.pass));
      onRequestHandled?.(request);
    });
    return () => { current = false; };
  });
  useLayoutEffect(() => {
    if (!focusForm.current || !formTitle.current || confirmation) return;
    focusForm.current = false;
    formTitle.current.focus({ preventScroll: true });
  });

  const change = (group: ILXMRepeatEndingGroup, ending: ILXMRepeatEnding) => {
    setDraft({ group, ending, dirty: true });
    setError(undefined);
  };
  const cancel = () => {
    registration.invalidateOwner();
    close();
    heading.current?.focus();
  };
  const commit = async (operation: (owner: EditorDraftOwner) => boolean | Promise<boolean>) => {
    if (disabled || committing.current) return;
    const identity = registration.captureIdentity();
    const applying = validDraft;
    committing.current = true;
    setBusy(true);
    setError(undefined);
    let success = false;
    try { success = await operation(identity.owner); }
    catch { /* 保留当前草稿供重试，流程仍由会话适配器检查版本。 */ }
    finally {
      committing.current = false;
      if (heading.current?.isConnected) setBusy(false);
    }
    if (!heading.current?.isConnected || currentDraft.current !== applying || !registration.isCurrent(identity)) return;
    if (success) cancel();
    else setError("未能提交反复房子，请检查范围后重试。");
  };

  const nextGroup = validDraft && {
    ...validDraft.group,
    endings: [...(activeGroup?.endings ?? []).filter(({ id }) => id !== validDraft.ending.id), validDraft.ending],
  };
  const issues = nextGroup ? inspectRepeatEndingGroups(measures, [
    ...groups.filter(({ id }) => id !== nextGroup.id), nextGroup,
  ]).issues : [];
  const fieldIssues = (field: string, ending = false) => issues.filter((issue) =>
    issue.field === field && (issue.endingIndex !== undefined) === ending,
  ).map(({ message }) => message).join("。") || undefined;
  const blocked = disabled || busy;
  const field = (name: string, value: string, update: (value: string) => void, issue?: string) => (
    <label className={styles.field}>{name}
      <select disabled={blocked} aria-label={name} aria-invalid={!!issue} value={value} onChange={(event) => update(event.target.value)}>
        {!indexes.has(value) && <option value={value}>请选择小节</option>}
        {measures.map((measure, index) => <option key={measure.id} value={measure.id}>{label(index)}</option>)}
      </select>
      {issue && <span className={styles.issue} role="alert">{issue}</span>}
    </label>
  );

  return (
    <section className={styles.inspector} aria-labelledby={titleId} data-repeat-ending-inspector onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || !validDraft || confirmation || busy) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }}>
      <div className={styles.heading}>
        <h3 id={titleId} ref={heading} tabIndex={-1}>反复房子</h3>
        <Button size="small" disabled={blocked || measures.length < 2} onClick={() => open(newDraft())}>插入反复房子</Button>
      </div>
      {validDraft && nextGroup ? <form className={styles.form} aria-label={validDraft.ending.id ? "编辑反复房子" : "插入反复房子"} onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && !issues.length) void commit((owner) => onApply(nextGroup, validDraft.ending, owner));
      }}>
        <h4 ref={formTitle} tabIndex={-1} className={styles.hint}>{validDraft.ending.id ? "编辑反复房子" : "插入反复房子"}</h4>
        {!validDraft.ending.id && groups.length > 0 && <label className={styles.field}>所属反复组
          <select value={validDraft.group.id} disabled={blocked} onChange={(event) => {
            const id = event.target.value;
            const next = newDraft(groups.find((group) => group.id === id), undefined, !id);
            if (next) change(next.group, next.ending);
          }}>
            <option value="">新建反复组</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)}</option>)}
          </select>
        </label>}
        {field("反复起点", nextGroup.startMeasureId, (id) => change({ ...nextGroup, startMeasureId: id }, validDraft.ending), fieldIssues("startMeasureId"))}
        {field("共享段末小节", nextGroup.sharedEndMeasureId, (id) => change({ ...nextGroup, sharedEndMeasureId: id }, validDraft.ending), fieldIssues("sharedEndMeasureId"))}
        {field("结尾区末小节", nextGroup.endMeasureId, (id) => change({ ...nextGroup, endMeasureId: id }, validDraft.ending), fieldIssues("endMeasureId"))}
        {indexes.has(nextGroup.endMeasureId) && <p className={styles.hint}>共同出口 · {measures[indexOf(nextGroup.endMeasureId) + 1] ? label(indexOf(nextGroup.endMeasureId) + 1) : "曲谱末"}</p>}
        <label className={styles.field}>反复次数
          <select value={nextGroup.passCount} disabled={blocked} aria-invalid={!!fieldIssues("passCount")} onChange={(event) => change({
            ...nextGroup, passCount: Number(event.target.value),
          }, validDraft.ending)}>
            <option value={2}>2 遍</option><option value={3}>3 遍</option>
          </select>
        </label>
        {field("房子起始小节", validDraft.ending.startMeasureId, (id) => change(nextGroup, { ...validDraft.ending, startMeasureId: id }), fieldIssues("startMeasureId", true))}
        {field("房子结束小节", validDraft.ending.endMeasureId, (id) => change(nextGroup, { ...validDraft.ending, endMeasureId: id }), fieldIssues("endMeasureId", true))}
        <fieldset className={styles.passes} disabled={blocked}>
          <legend>演奏遍次</legend>
          {[1, 2, 3].filter((pass) => pass <= nextGroup.passCount || validDraft.ending.passes.includes(pass)).map((pass) => (
            <label key={pass}><input type="checkbox" checked={validDraft.ending.passes.includes(pass)} onChange={(event) => change(nextGroup, {
              ...validDraft.ending,
              passes: event.target.checked ? [...validDraft.ending.passes, pass] : validDraft.ending.passes.filter((value) => value !== pass),
            })} />第 {pass} 遍</label>
          ))}
        </fieldset>
        {fieldIssues("passes", true) && <p className={styles.issue} role="alert">{fieldIssues("passes", true)}</p>}
        <div className={styles.actions}>
          <Button size="small" type="primary" htmlType="submit" loading={busy} disabled={blocked || issues.length > 0}>应用</Button>
          <Button size="small" onClick={cancel} disabled={busy}>取消</Button>
          {validDraft.ending.id && <Button danger size="small" type="text" disabled={blocked}
            onClick={() => setConfirmation({ kind: "delete", ending: activeGroup!.endings.find(({ id }) => id === validDraft.ending.id)! })}>删除</Button>}
        </div>
      </form> : groups.map((group) => {
        const missing = getMissingRepeatEndingPasses(group);
        const unused = measures.filter((measure, index) => index > indexOf(group.sharedEndMeasureId) && index <= indexOf(group.endMeasureId) &&
          !group.endings.some((ending) => index >= indexOf(ending.startMeasureId) && index <= indexOf(ending.endMeasureId)));
        return <div key={group.id} className={styles.group}>
          <div className={styles.row}><strong>反复组 · {groupLabel(group)}</strong><span className={styles.hint}>{group.passCount} 遍</span></div>
          {group.endings.map((ending) => <div key={ending.id} className={styles.row}>
            <span>{passesLabel(ending.passes)} · {range(ending.startMeasureId, ending.endMeasureId)}</span>
            <Button size="small" disabled={blocked} onClick={() => open({ group, ending, dirty: false }, true)}>编辑</Button>
          </div>)}
          {missing.map((pass) => <div key={pass} className={styles.row}>
            <span className={styles.issue}>第 {pass} 遍没有反复房子</span>
            <Button size="small" disabled={blocked} onClick={() => open(newDraft(group, pass))}>补第 {pass} 遍</Button>
          </div>)}
          {unused.length > 0 && <p className={styles.hint}>未被任何遍次演奏 · {unused.map(({ id }) => indexOf(id) + 1).join("、")} 小节</p>}
          {!group.endings.length && onDeleteGroup && <Button danger size="small" type="text" disabled={blocked}
            onClick={() => setConfirmation({ kind: "deleteGroup", group })}>删除反复组</Button>}
        </div>;
      })}
      {error && <p className={styles.issue} role="alert">{error}</p>}
      <Modal open={!!confirmation} centered width={440} keyboard={false} mask={{ closable: false }}
        title={confirmation?.kind === "switch" ? "放弃未应用的反复房子编辑？" : confirmation?.kind === "deleteGroup" ? "删除反复组？" : "删除反复房子？"}
        okText={confirmation?.kind === "switch" ? "放弃修改" : "删除"} cancelText="取消"
        okButtonProps={{ danger: confirmation?.kind !== "switch", disabled: blocked }}
        onCancel={() => setConfirmation(null)} onOk={() => {
          if (!confirmation || blocked) return;
          setConfirmation(null);
          if (confirmation.kind === "switch") begin(confirmation.draft, confirmation.locate);
          else if (confirmation.kind === "delete") void commit((owner) => onDelete(confirmation.ending.id, owner));
          else if (onDeleteGroup) void commit((owner) => onDeleteGroup(confirmation.group.id, owner));
        }} modalRender={(content) => <EditorModalGuard dismissable onDismiss={() => setConfirmation(null)}>{content}</EditorModalGuard>}>
        {confirmation?.kind === "delete" && <p>删除后{passesLabel(confirmation.ending.passes)}缺少房子，试听到相应遍次的分岔时暂停。</p>}
        {confirmation?.kind === "deleteGroup" && <p>删除后，这段按谱面上的普通反复线演奏。</p>}
        {confirmation?.kind === "switch" && <p>当前草稿尚未应用。</p>}
      </Modal>
    </section>
  );
}
