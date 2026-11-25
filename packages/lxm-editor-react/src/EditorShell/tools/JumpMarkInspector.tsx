"use client";

import { Button, Modal, Select } from "antd";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createJumpMarkIndex,
  getJumpMarkCandidates,
  getJumpMarkDependents,
  getJumpMarkFields,
  getJumpMarkSide,
  inspectJumpMark,
  isCapoJumpMark,
  JUMP_MARK_LABEL,
  resolveJumpMarkDraft,
  type ILXMJumpMark,
  type ILXMJumpMarkKind,
  type ILXMMeasure,
  type JumpMarkEntry,
  type JumpMarkField,
} from "@liuxianmao/lxm-editor";
import { useEditorDraftRecords } from "../session/EditorSessionRuntime";
import { EditorModalGuard } from "../session/EditorModalGuard";
import type { EditorDraftOwner, EditorDraftRecord } from "../session/editor-draft-coordinator";
import type { EditorSessionVersion } from "../session/editor-session-version";
import styles from "./JumpMarkInspector.module.scss";

export interface JumpMarkInspectorRequest {
  markId?: string;
  /** 小节工具的谱面符号可以直接打开指定类型；已有记号优先按稳定身份编辑。 */
  markKind?: ILXMJumpMarkKind;
  /** 右键与工具栏可以只定位到本节，或直接打开插入表单。 */
  mode?: "section" | "insert";
}

export interface JumpMarkInspectorProps {
  measures: readonly ILXMMeasure[];
  measureId: string;
  /** 每次外部定位传入新的请求对象。 */
  request?: JumpMarkInspectorRequest;
  onRequestHandled?: (request: JumpMarkInspectorRequest) => void;
  version?: EditorSessionVersion;
  disabled?: boolean;
  onLocateMark: (id: string) => void;
  onDraftMeasure: (id: string | undefined) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onApply: (measureId: string, mark: ILXMJumpMark, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
  onDelete: (id: string, owner?: EditorDraftOwner) => boolean | Promise<boolean>;
}

type Index = ReturnType<typeof createJumpMarkIndex>;
type Inspection = ReturnType<typeof inspectJumpMark>;
const fields: Record<JumpMarkField, { label: string; target: ILXMJumpMarkKind }> = {
  segnoId: { label: "回到 Segno", target: "segno" },
  toCodaId: { label: "重奏中的 To Coda", target: "toCoda" },
  codaId: { label: "跳到 Coda", target: "coda" },
  fineId: { label: "重奏结束于 Fine", target: "fine" },
};
const kinds = ["segno", "ds", "dsAlCoda", "toCoda", "coda", "dc", "fine", "dcAlFine", "dsAlFine", "dcAlCoda"] as const;
const measureLabel = (index: number) => `第 ${index + 1} 小节`;
const entryLabel = ({ mark, measureIndex }: JumpMarkEntry) => `${measureLabel(measureIndex)} ${JUMP_MARK_LABEL[mark.kind]}`;
const kindOptions = kinds.map((value) => ({ value, label: JUMP_MARK_LABEL[value] }));

interface Draft {
  sourceMeasureId: string;
  measureId: string;
  mark: ILXMJumpMark;
  dirty: boolean;
}

type OpenIntent = { kind: "insert"; markKind?: ILXMJumpMarkKind } | { kind: "section" } | { kind: "edit"; entry: JumpMarkEntry; locate: boolean };
type Confirmation = { kind: "switch"; intent: OpenIntent } | { kind: "changeKind" | "delete"; entry: JumpMarkEntry };

interface PairingRow {
  key: string;
  label: string;
  from: JumpMarkEntry;
  to?: JumpMarkEntry;
  targetKind?: ILXMJumpMarkKind;
  issues?: readonly string[];
}

/** 链路只读已存配对。孤立的 To Coda 也可编辑自己的 Coda 目标。 */
function getPairingRows(entry: JumpMarkEntry, index: Index, inspection: Inspection): PairingRow[] {
  const { mark } = entry;
  const issues = (field: JumpMarkField) => inspection.issues.filter((issue) => issue.field === field).map((issue) => issue.message);
  const rows: PairingRow[] = [];
  if (getJumpMarkFields(mark.kind).includes("segnoId"))
    rows.push({ key: "segno", label: "弹完回跳", from: entry, to: inspection.segno, targetKind: "segno", issues: issues("segnoId") });
  if (isCapoJumpMark(mark.kind)) rows.push({ key: "start", label: "弹完回跳", from: entry });
  if (getJumpMarkFields(mark.kind).includes("fineId"))
    rows.push({ key: "fine", label: "重奏结束", from: entry, to: inspection.fine, targetKind: "fine", issues: issues("fineId") });
  if (getJumpMarkFields(mark.kind).includes("toCodaId"))
    rows.push({ key: "exit", label: "重奏时找出口", from: entry, to: inspection.toCoda, targetKind: "toCoda", issues: issues("toCodaId") });
  const exit = mark.kind === "toCoda" ? entry : inspection.toCoda;
  if (exit)
    rows.push({ key: "coda", label: "重奏时进入尾声", from: exit, to: inspection.coda, targetKind: "coda", issues: issues("codaId") });
  // 入口链路只显示直接配对，影响确认则另外包含经 To Coda 传递的指令。
  const incoming = getJumpMarkDependents(mark.id, index).filter(({ mark: other }) =>
    getJumpMarkFields(other.kind).some((field) => fields[field].target === mark.kind && other[field] === mark.id));
  for (const source of incoming)
    rows.push({ key: `incoming:${source.mark.id}`, label: getJumpMarkSide(mark.kind) === "end" ? "由回跳指令启用" : "从这里跳入", from: source, to: entry, targetKind: mark.kind });
  return rows;
}

function PairingCard({ entry, index, disabled, onEdit, onLocate }: {
  entry: JumpMarkEntry;
  index: Index;
  disabled: boolean;
  onEdit: () => void;
  onLocate: (entry: JumpMarkEntry) => void;
}) {
  const { mark } = entry;
  const rows = getPairingRows(entry, index, inspectJumpMark(entry, index));
  const node = (part: JumpMarkEntry) => {
    const label = <><span className={styles.number}>{part.measureIndex + 1}</span>{JUMP_MARK_LABEL[part.mark.kind]}</>;
    return part.mark.id === mark.id || disabled ? <span className={styles.node}>{label}</span> : (
      <Button size="small" className={styles.link} aria-label={`编辑${entryLabel(part)}`} onClick={() => onLocate(part)}>{label}</Button>
    );
  };
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <div><strong>{JUMP_MARK_LABEL[mark.kind]}</strong><small>{getJumpMarkSide(mark.kind) === "start" ? "小节开头 · 落点" : "小节末 · 弹完触发"}</small></div>
        <Button size="small" disabled={disabled} aria-label={`编辑 ${JUMP_MARK_LABEL[mark.kind]}`} onClick={onEdit}>编辑</Button>
      </div>
      {rows.length === 0 ? <p className={styles.hint}>{mark.kind === "fine" ? "还没有回跳指令配对此结束位置。" : "还没有指令指向此落点。"}</p> : (
        <ul className={styles.pairings}>
          {rows.map((row) => (
            <li key={row.key}>
              <small>{row.label}</small>
              <div className={styles.chain}>
                {node(row.from)}<span aria-hidden="true">→</span>
                {row.to ? node(row.to) : row.targetKind ? <span className={styles.missing}>{JUMP_MARK_LABEL[row.targetKind]} 待配对</span> : <span className={styles.node}>第 1 小节 曲首</span>}
              </div>
              {row.issues?.map((issue) => <p className={styles.issue} key={issue}>{issue}</p>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 将草稿替换进临时索引，移动保留 ID，关联指令按新位置校验。实际谱件仍由命令更新。 */
function inspectDraft(draft: Draft, measures: readonly ILXMMeasure[], index: Index) {
  const { mark, measureId } = draft;
  const original = mark.id ? index.byId.get(mark.id) : undefined;
  const isOccupied = index.entries.some((entry) => entry.measureId === measureId &&
    entry.mark.id !== mark.id && getJumpMarkSide(entry.mark.kind) === getJumpMarkSide(mark.kind));
  const prospective = (next: ILXMJumpMark) => createJumpMarkIndex(measures.map((measure) => {
    if (measure.id !== measureId && measure.id !== original?.measureId) return measure;
    const jumpMarks = (measure.jumpMarks ?? []).filter((item) => item.id !== next.id);
    if (measure.id === measureId) jumpMarks.push(next);
    return { ...measure, jumpMarks };
  }));
  // 先移除原类型再找候选，避免把改类前的自己当作唯一目标。
  const candidateIndex = prospective(mark);
  const resolved = resolveJumpMarkDraft(mark, candidateIndex);
  const predicted = prospective(resolved);
  const entry = predicted.byId.get(mark.id);
  const inspection = entry && inspectJumpMark(entry, predicted);

  // 草稿自身显示全部问题。依赖项仅补充本次移动或修改新增的问题，避免重复显示旧问题。
  const ownIssues = inspection?.issues ?? [];
  const otherIssues = new Map<string, { entry: JumpMarkEntry; message: string }>();
  const addOtherIssue = (ownerId: string, field: JumpMarkField, message: string) => {
    const owner = predicted.byId.get(ownerId);
    if (owner) otherIssues.set(JSON.stringify([ownerId, field, message]), { entry: owner, message });
  };
  for (const issue of ownIssues)
    if (issue.markId !== mark.id) addOtherIssue(issue.markId, issue.field, issue.message);
  const dependents = original ? getJumpMarkDependents(mark.id, index) : [];
  for (const dependent of dependents) {
    const before = inspectJumpMark(dependent, index).issues;
    for (const issue of inspectJumpMark(dependent, predicted).issues) {
      if (issue.markId !== mark.id && !before.some((known) => known.markId === issue.markId && known.field === issue.field && known.message === issue.message))
        addOtherIssue(issue.markId, issue.field, issue.message);
    }
  }
  return { original, isOccupied, candidateIndex, resolved, ownIssues, otherIssues: [...otherIssues.values()], dependents };
}

export function JumpMarkInspector({ measures, measureId, request, onRequestHandled, version, disabled = false, onLocateMark,
  onDraftMeasure, onDirtyChange, onApply, onDelete }: JumpMarkInspectorProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formTitleRef = useRef<HTMLElement>(null);
  const consumedRequest = useRef<JumpMarkInspectorRequest | undefined>(undefined);
  const pendingFocus = useRef<"form" | "heading" | null>(null);
  const committing = useRef(false);
  const mounted = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const index = useMemo(() => createJumpMarkIndex(measures), [measures]);
  const measureOptions = useMemo(() => measures.map(({ id }, i) => ({ value: id, label: measureLabel(i) })), [measures]);
  const measuresById = useMemo(() => new Map(measures.map((measure, i) => [measure.id, i])), [measures]);
  const at = index.entries.filter((entry) => entry.measureId === measureId);
  const validDraft = draft && draft.sourceMeasureId === measureId && measuresById.has(draft.measureId) &&
    (!draft.mark.id || index.byId.has(draft.mark.id)) ? draft : null;
  if (draft && !validDraft) {
    // 换小节或目标被移除时，清理原表单，避免重新选回后恢复过期的输入。
    setDraft(null);
    setConfirmation(null);
    setSubmitError(null);
  }
  const preview = useMemo(() => validDraft && inspectDraft(validDraft, measures, index), [validDraft, measures, index]);
  const currentDraft = useRef<Draft | null>(null);
  useLayoutEffect(() => { currentDraft.current = validDraft; }, [validDraft]);

  const notifications = useRef({ onDraftMeasure, onDirtyChange });
  useLayoutEffect(() => { notifications.current = { onDraftMeasure, onDirtyChange }; });
  const previewMeasure = disabled ? undefined : validDraft?.measureId;
  const dirty = !!validDraft?.dirty;
  useLayoutEffect(() => { notifications.current.onDraftMeasure(previewMeasure); }, [previewMeasure]);
  useLayoutEffect(() => { notifications.current.onDirtyChange?.(dirty); }, [dirty]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      notifications.current.onDraftMeasure(undefined);
      notifications.current.onDirtyChange?.(false);
    };
  }, []);

  const closeDraft = useCallback((restoreFocus = true) => {
    pendingFocus.current = restoreFocus ? "heading" : null;
    setDraft(null);
    setSubmitError(null);
    setConfirmation(null);
  }, []);

  // 只登记有修改的表单。统一闸门提供定位和放弃，改类确认仍由这里的应用入口处理。
  const { document: scoreDocument, sessionId, sessionVersion, stateVersion } = version ?? {};
  const draftMeasureIndex = validDraft ? measuresById.get(validDraft.measureId) : undefined;
  const records = useMemo<readonly EditorDraftRecord[]>(() => {
    if (!validDraft?.dirty || draftMeasureIndex === undefined || scoreDocument === undefined ||
      sessionId === undefined || sessionVersion === undefined || stateVersion === undefined) return [];
    return [{
      id: `jump-mark:${titleId}`,
      kind: "jumpMark",
      targetKey: validDraft.mark.id || validDraft.sourceMeasureId,
      label: "跳转记号编辑",
      location: measureLabel(draftMeasureIndex),
      dirty: true,
      composing: false,
      canApply: false,
      error: "请在「反复与跳转」原表单应用。",
      version: { document: scoreDocument, sessionId, sessionVersion, stateVersion },
      focus: () => {
        const title = formTitleRef.current;
        if (!title?.isConnected) return false;
        title.scrollIntoView({ block: "nearest" });
        title.focus({ preventScroll: true });
        return true;
      },
      apply: () => "blocked",
      discard: () => {
        if (committing.current || currentDraft.current !== validDraft) return false;
        // 批量放弃按目录版本保护，留给 hook 在 React 更新后统一注销本条登记。
        closeDraft(false);
        return true;
      },
    }];
  }, [closeDraft, draftMeasureIndex, scoreDocument, sessionId, sessionVersion, stateVersion, titleId, validDraft]);
  const registration = useEditorDraftRecords(records);

  const begin = useCallback((intent: OpenIntent) => {
    if (intent.kind === "section") {
      headingRef.current?.scrollIntoView({ block: "nearest" });
      headingRef.current?.focus({ preventScroll: true });
      return;
    }
    registration.invalidateOwner();
    setSubmitError(null);
    setConfirmation(null);
    if (intent.kind === "edit") {
      const entry = index.byId.get(intent.entry.mark.id);
      if (!entry) return;
      pendingFocus.current = "form";
      setDraft({ sourceMeasureId: entry.measureId, measureId: entry.measureId, mark: entry.mark, dirty: false });
      if (intent.locate) {
        // 显式接受离开后先同步释放草稿守卫，随后工作台才能切换谱面选区。
        notifications.current.onDirtyChange?.(false);
        onLocateMark(entry.mark.id);
      }
    } else {
      if (!measuresById.has(measureId)) return;
      const hasStart = index.entries.some((entry) => entry.measureId === measureId && getJumpMarkSide(entry.mark.kind) === "start");
      pendingFocus.current = "form";
      // 留空 ID 由命令创建，避免预览或取消消耗持久化身份。
      const kind = intent.markKind ?? (hasStart ? "dsAlCoda" : "segno");
      setDraft({ sourceMeasureId: measureId, measureId, mark: { id: "", kind }, dirty: false });
    }
  }, [index, measureId, measuresById, onLocateMark, registration]);

  const open = useCallback((intent: OpenIntent) => {
    if (disabled || committing.current) return;
    if (intent.kind === "section") begin(intent);
    else if (intent.kind === "edit" && validDraft?.mark.id === intent.entry.mark.id) {
      formTitleRef.current?.focus({ preventScroll: true });
    } else if (validDraft?.dirty) {
      setConfirmation({ kind: "switch", intent });
    } else begin(intent);
  }, [begin, disabled, validDraft]);

  useLayoutEffect(() => {
    if (!request || consumedRequest.current === request || disabled || busy) return;
    const entry = request.markId ? index.byId.get(request.markId) : undefined;
    // 外部定位可能先打开侧栏，再刷新小节选区。等两者一致后消费请求。
    if (entry && entry.measureId !== measureId) return;
    if (!measuresById.has(measureId)) return;
    // 让父级完成选区和侧栏同一次提交，再交接请求。被替换或卸载的请求不得打开旧草稿。
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      consumedRequest.current = request;
      if (entry) open({ kind: "edit", entry, locate: false });
      else if (!request.markId) open(request.mode === "section" ? { kind: "section" } : { kind: "insert", markKind: request.markKind });
      onRequestHandled?.(request);
    });
    return () => { current = false; };
  }, [busy, disabled, index, measureId, measuresById, onRequestHandled, open, request]);

  useLayoutEffect(() => {
    if (confirmation) return;
    // 由谱面或符号按钮进入时先读到表单标题，Tab 再从第一个可编辑字段开始。
    if (pendingFocus.current === "form" && formTitleRef.current) {
      pendingFocus.current = null;
      formTitleRef.current.scrollIntoView({ block: "nearest" });
      formTitleRef.current.focus({ preventScroll: true });
    } else if (pendingFocus.current === "heading") {
      pendingFocus.current = null;
      headingRef.current?.focus({ preventScroll: true });
    }
  });

  const cancel = () => {
    if (committing.current) return;
    registration.invalidateOwner();
    closeDraft();
  };
  const change = (mark: ILXMJumpMark, destination = validDraft?.measureId) => {
    if (!validDraft || !destination) return;
    setSubmitError(null);
    setDraft({ ...validDraft, mark, measureId: destination, dirty: true });
  };
  const changeKind = (kind: ILXMJumpMarkKind) => {
    if (!validDraft) return;
    const { mark } = validDraft;
    const next: ILXMJumpMark = { id: mark.id, kind };
    // 同语义字段跨类型保留已选身份，例如 D.S. al Fine 改为 D.C. al Fine 时保留 Fine。
    for (const field of getJumpMarkFields(kind)) if (mark[field]) next[field] = mark[field];
    change(next);
  };
  const commit = async (run: (owner: EditorDraftOwner) => boolean | Promise<boolean>, error: string) => {
    if (disabled || committing.current || !validDraft) return;
    const identity = registration.captureIdentity();
    committing.current = true;
    setBusy(true);
    setSubmitError(null);
    let applied = false;
    try { applied = await run(identity.owner); }
    catch { /* 适配器失败时保留原草稿，允许在原入口重试。 */ }
    finally {
      committing.current = false;
      if (mounted.current) setBusy(false);
    }
    // 中央命令可能切换选区；迟到返回不能关闭新草稿或把错误显示到其它小节。
    if (!mounted.current || currentDraft.current !== validDraft || !registration.isCurrent(identity)) return;
    if (applied) cancel();
    else setSubmitError(error);
  };
  const apply = (confirmed = false) => {
    if (disabled || committing.current || !validDraft || !preview || preview.isOccupied) return;
    if (!confirmed && preview.original && preview.original.mark.kind !== validDraft.mark.kind && preview.dependents.length) {
      setConfirmation({ kind: "changeKind", entry: preview.original });
      return;
    }
    // 悬空和位置诊断是可保存状态。同端冲突由面板和命令共同拦截。
    void commit((owner) => onApply(validDraft.measureId, preview.resolved, owner), "未能应用记号，请检查当前位置后重试。");
  };
  const confirm = () => {
    if (disabled || committing.current || !confirmation) return;
    setConfirmation(null);
    if (confirmation.kind === "switch") begin(confirmation.intent);
    else if (confirmation.kind === "changeKind") apply(true);
    else void commit((owner) => onDelete(confirmation.entry.mark.id, owner), "未能删除记号，请重试。");
  };

  // 其他小节也可能因删改而悬空。汇总按问题归属去重，便于一次回到真正待修复的指令。
  const unresolved = useMemo(() => index.entries.flatMap((entry) => inspectJumpMark(entry, index).issues
    .filter((issue) => issue.markId === entry.mark.id)
    .map((issue) => ({ entry, ...issue }))), [index]);

  if (!measuresById.has(measureId)) return null;
  const impact = confirmation && confirmation.kind !== "switch" ? getJumpMarkDependents(confirmation.entry.mark.id, index) : [];
  const blocked = disabled || busy;
  const original = preview?.original;
  const formLabel = validDraft?.mark.id ? "编辑记号" : "插入记号";
  return (
    <section ref={rootRef} className={styles.inspector} aria-labelledby={titleId} data-jump-mark-inspector onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || !validDraft || confirmation || busy || event.target instanceof Element &&
        (!rootRef.current?.contains(event.target) || event.target.closest('.ant-select-open,[aria-expanded="true"][role="combobox"]'))) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }}>
      <div className={styles.row}>
        <h3 ref={headingRef} id={titleId} tabIndex={-1}>反复与跳转</h3>
        <Button size="small" disabled={blocked} onClick={() => open({ kind: "insert" })}>插入记号</Button>
      </div>
      {validDraft && preview ? (
        <form className={styles.form} aria-label={formLabel} onSubmit={(event) => { event.preventDefault(); apply(); }}>
          <strong ref={formTitleRef} tabIndex={-1}>{formLabel}</strong>
          <label className={styles.field} htmlFor={`${titleId}-kind`}>记号类型
            <Select id={`${titleId}-kind`} aria-label="记号类型" size="small" value={validDraft.mark.kind} disabled={blocked} options={kindOptions} onChange={changeKind} />
          </label>
          <label className={styles.field} htmlFor={`${titleId}-measure`}>位置小节
            <Select id={`${titleId}-measure`} aria-label="位置小节" size="small" value={validDraft.measureId} disabled={blocked}
              options={measureOptions} onChange={(id) => change(validDraft.mark, id)} />
          </label>
          <p className={styles.hint}>{getJumpMarkSide(validDraft.mark.kind) === "start" ? "位于小节开头，与小节线对齐。" : "位于小节末端，弹完整节后触发。"}</p>
          {getJumpMarkFields(validDraft.mark.kind).map((field) => {
            const { label, target } = fields[field];
            const candidates = getJumpMarkCandidates(preview.resolved, field, preview.candidateIndex, measuresById.get(validDraft.measureId));
            const current = validDraft.mark[field];
            const value = current ?? preview.resolved[field] ?? "";
            const fieldId = `${titleId}-${field}`;
            const issues = preview.ownIssues.filter((issue) => issue.markId === validDraft.mark.id && issue.field === field);
            const options = candidates.map((candidate) => ({ value: candidate.mark.id, label: entryLabel(candidate) }));
            if (current && !candidates.some(({ mark }) => mark.id === current)) {
              const saved = preview.candidateIndex.byId.get(current);
              options.unshift({ value: current, label: saved?.mark.kind === target ? `${entryLabel(saved)}（位置待修复）` : "原配对已删除或改类" });
            }
            if (candidates.length !== 1) options.unshift({ value: "", label: candidates.length ? "请选择一处" : "暂无可用候选" });
            return (
              <label className={styles.field} key={field} htmlFor={fieldId}>{label}
                <Select id={fieldId} aria-label={label} size="small" options={options} value={value} disabled={blocked}
                  status={issues.length ? "error" : undefined} aria-invalid={issues.length > 0}
                  aria-describedby={issues.length ? `${fieldId}-issue` : undefined}
                  onChange={(id) => change({ ...validDraft.mark, [field]: id || undefined })} />
                {issues.length > 0 && <span className={styles.issue} id={`${fieldId}-issue`}>{issues.map(({ message }) => message).join("。")}</span>}
              </label>
            );
          })}
          {preview.otherIssues.map(({ entry, message }) => <div key={`${entry.mark.id}-${message}`} className={styles.issue}>
            <Button type="link" size="small" disabled={blocked} onClick={() => open({ kind: "edit", entry, locate: true })}>{entryLabel(entry)}</Button>
            <p className={styles.issue}>{message}</p>
          </div>)}
          {preview.isOccupied && <p className={styles.issue} role="alert">这个小节的同一端已有记号。请选择其它小节或编辑现有记号。</p>}
          {submitError && <p className={styles.issue} role="alert">{submitError}</p>}
          <div className={styles.actions}>
            <Button size="small" type="primary" htmlType="submit" loading={busy} disabled={blocked || preview.isOccupied}>应用</Button>
            <Button size="small" disabled={busy} onClick={cancel}>取消</Button>
            {original && <Button danger type="text" size="small" disabled={blocked} className={styles.delete}
              onClick={() => setConfirmation({ kind: "delete", entry: original })}>删除</Button>}
          </div>
        </form>
      ) : at.length ? (
        <div className={styles.marks}>
          {at.map((entry) => <PairingCard key={entry.mark.id} entry={entry} index={index} disabled={blocked}
            onEdit={() => open({ kind: "edit", entry, locate: false })}
            onLocate={(target) => open({ kind: "edit", entry: target, locate: true })} />)}
        </div>
      ) : <p className={styles.hint}>本小节还没有跳转记号。</p>}
      {!validDraft && unresolved.length > 0 && (
        <details className={styles.unresolved}>
          <summary>配对待补全（{unresolved.length}）</summary>
          <ul>
            {unresolved.map(({ entry, field, message }) => <li key={`${entry.mark.id}-${field}-${message}`}>
              <Button type="link" size="small" disabled={blocked} onClick={() => open({ kind: "edit", entry, locate: true })}>{entryLabel(entry)}</Button>
              <p className={styles.issue}>{message}</p>
            </li>)}
          </ul>
        </details>
      )}
      <Modal open={!!confirmation} centered width={440} keyboard={false} mask={{ closable: false }}
        title={confirmation?.kind === "switch" ? "放弃未应用的记号编辑？" : confirmation?.kind === "delete" ? `删除${entryLabel(confirmation.entry)}？` : "更改记号类型？"}
        okText={confirmation?.kind === "switch" ? "放弃修改" : confirmation?.kind === "delete" ? "删除" : "更改类型"}
        cancelText={confirmation?.kind === "switch" ? "继续编辑" : "取消"} okButtonProps={{ danger: confirmation?.kind === "delete", disabled }}
        onOk={confirm} onCancel={() => setConfirmation(null)}
        modalRender={(content) => <EditorModalGuard dismissable onDismiss={() => setConfirmation(null)}>{content}</EditorModalGuard>}>
        {confirmation?.kind === "switch" ? <p>当前修改尚未应用。</p> : impact.length ? <>
          <p>以下指令的配对将受影响，请在应用后重新指定目标。</p>
          <ul className={styles.impactList}>{impact.map((entry) => <li key={entry.mark.id}>{entryLabel(entry)}</li>)}</ul>
        </> : <p>确认后，谱面将移除此记号。</p>}
      </Modal>
    </section>
  );
}
