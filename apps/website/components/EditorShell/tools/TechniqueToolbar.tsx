"use client";
import { Alert, Button, ConfigProvider, Input, Tooltip } from "antd";
import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
import { ShortcutTooltip } from "../session/EditorShortcutReference";
import { LXMScoreCommandEnum as C, resolveTechniqueSelection, type ILXMDocument,
  type ILXMTabCellSelection, type ILXMTechniqueDraft, type ILXMTechniqueType } from "@liuxianmao/lxm-editor";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { useEditorRuntime } from "../session/EditorSessionRuntime";
import { useEditorSessionStore } from "../../../stores/editor-store";
import { captureEditorVersion } from "../session/editor-session-version";
import { TECHNIQUE_GROUPS, TECHNIQUE_OPTIONS } from "./technique-catalog";
import { resolveTechniqueDraft, type TechniqueIntent, type TechniqueParameters } from "./editor-technique-target";
import { captureEditorToolIntent, tabToolTargetReason } from "./editor-tool-guard";
import { createTechniqueParameterOwner } from "./technique-parameter-owner";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";
import { isEditorInputEnter } from "../shared/editor-input-enter";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { parseTechniqueTrillFret, resolveToolbarTechnique, techniqueNeedsConnection, techniqueNeedsParameters,
  techniquesInToolbarSelection, toolbarTechniqueAvailability } from "./technique-toolbar-model";
import { TechniqueToolbarIcon } from "./TechniqueToolbarIcon";
import styles from "./TechniqueToolbar.module.scss";

export interface TechniqueToolbarController {
  openTechnique: (intent: TechniqueIntent) => boolean;
  canHide: () => boolean;
  discard: () => boolean;
}
interface TechniqueToolbarProps {
  ref?: Ref<TechniqueToolbarController>;
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  selectedTechniqueId: string | null;
  execute: EditorCommandAdapter;
  blocked: boolean;
  beforeAction?: () => void;
  getActiveTarget?: () => MusicTextTarget | null;
  onShowParameters: () => void;
  onSuccess: () => void;
  onClose?: () => void;
  setSelectedTechniqueId: (id: string | null) => void;
  setErrorMessage: (message: string | null) => void;
}
type SubmissionInput = TechniqueParameters & { type: ILXMTechniqueType; id: string | null };
const label = (type: ILXMTechniqueType) => TECHNIQUE_OPTIONS.find(item => item.value === type)?.label ?? type;

/** One parameter owner survives visibility changes; all changes use the shared command adapter. */
export const TechniqueToolbar = ({ ref, document, selection, selectedTechniqueId, execute, blocked,
  beforeAction, getActiveTarget = () => null, onShowParameters, onSuccess, onClose,
  setSelectedTechniqueId, setErrorMessage }: TechniqueToolbarProps) => {
  const { modals, drafts } = useEditorRuntime();
  const session = useEditorSessionStore();
  const renderedIntent = captureEditorToolIntent(session.getState, getActiveTarget);
  const [owner] = useState(() => createTechniqueParameterOwner(drafts));
  const parameterRegion = useRef<HTMLDivElement>(null);
  const [ownerRevision, refreshOwner] = useState(0);
  const [composition] = useState(() => createScoreSettingsComposition(protectedInput => {
    if (protectedInput) owner.compositionStart();
    else { owner.compositionEnd(); owner.releaseCompositionBuffer(); }
    refreshOwner(revision => revision + 1);
  }));
  const initialSelected = document.score.tracks.flatMap(track => track.techniques).find(item => item.id === selectedTechniqueId);
  const [loadedId, setLoadedId] = useState(selectedTechniqueId);
  const [active, setActive] = useState(!!initialSelected);
  const [replacing, setReplacing] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [type, setType] = useState<ILXMTechniqueType>(initialSelected?.type ?? "hammerOn");
  const [direction, setDirection] = useState<"down" | "up">(initialSelected?.type === "arpeggio"
    ? initialSelected.direction === "ascending" ? "down" : "up"
    : initialSelected?.type === "strum" || initialSelected?.type === "pickStroke" ? initialSelected.stroke : "down");
  const [semitones, setSemitones] = useState<1 | 2>(initialSelected?.type === "bend" ? initialSelected.semitones : 2);
  const [trillText, setTrillText] = useState(String(initialSelected?.type === "trill" ? initialSelected.auxiliaryFret : 7));
  const trillFret = parseTechniqueTrillFret(trillText);
  const [shortcut, setShortcut] = useState<TechniqueIntent["type"] | null>(null);
  const [directionChosen, setDirectionChosen] = useState(true);
  const [slideChosen, setSlideChosen] = useState(true);
  const currentInput = useRef<(() => boolean) | null>(null);
  const inputTargetKey = useRef(JSON.stringify({ selection, selectedTechniqueId }));
  const inputVersion = useRef(captureEditorVersion(session.getState()));
  const [boundTarget, setBoundTarget] = useState({ document, selection });
  const report = (message: string) => { setIssue(message); setErrorMessage(message); };
  const focus = () => {
    onShowParameters();
    parameterRegion.current?.querySelector<HTMLElement>("input,button")?.focus();
    return true;
  };
  const selected = useMemo(() => document.score.tracks.flatMap(track => track.techniques)
    .find(item => item.id === loadedId) ?? null, [document, loadedId]);
  const captureInput = () => {
    const state = session.getState();
    currentInput.current = captureEditorToolIntent(session.getState, getActiveTarget);
    inputVersion.current = captureEditorVersion(state);
    setBoundTarget({ document: state.document!, selection: state.selection });
    inputTargetKey.current = JSON.stringify({ selection: state.selection, selectedTechniqueId: state.selectedTechniqueId });
  };
  const load = (id: string | null) => {
    const value = session.getState().document?.score.tracks.flatMap(track => track.techniques).find(item => item.id === id);
    owner.reset();
    setLoadedId(value?.id ?? null); setActive(!!value); setReplacing(false);
    setType(value?.type ?? "hammerOn");
    setDirection(value?.type === "arpeggio" ? value.direction === "ascending" ? "down" : "up"
      : value?.type === "strum" || value?.type === "pickStroke" ? value.stroke : "down");
    setSemitones(value?.type === "bend" ? value.semitones : 2);
    setTrillText(String(value?.type === "trill" ? value.auxiliaryFret : 7));
    setShortcut(null); setDirectionChosen(true); setSlideChosen(true); setIssue(null);
    captureInput(); refreshOwner(revision => revision + 1);
  };
  const discard = () => {
    if (!owner.canHide()) return false;
    load(session.getState().selectedTechniqueId);
    return true;
  };
  const loadCurrent = useRef(load);
  useLayoutEffect(() => { loadCurrent.current = load; });
  useEffect(() => session.subscribe((next, previous) => {
    const boundary = next.sessionId !== previous.sessionId || next.sessionVersion !== previous.sessionVersion;
    const targetChanged = next.selection !== previous.selection || next.selectedTechniqueId !== previous.selectedTechniqueId;
    const documentChanged = next.document !== previous.document;
    if (boundary || ((targetChanged || documentChanged) && owner.canHandoff())) {
      const cancelled = owner.isDirty();
      loadCurrent.current(next.selectedTechniqueId);
      if (cancelled) setIssue("目标或文档已变化，已取消未应用的技巧参数。");
    }
  }), [owner, session]);
  useEffect(() => () => { composition.dispose(); owner.dispose(); }, [composition, owner]);
  const handoffAllowed = () => {
    if (!renderedIntent()) { report("目标或文档已变化，请重新选择技巧。"); return false; }
    if (blocked) { report("请先处理属性草稿并选择有效 TAB 目标。"); return false; }
    if (modals.isOpen()) { report("请先完成当前弹层操作。"); return false; }
    if (!owner.canHandoff()) { report("请先完成当前输入或提交。"); focus(); return false; }
    return true;
  };
  const changed = (change: () => void) => {
    if (!owner.canEdit() || !renderedIntent()) return false;
    if (!owner.isDirty()) captureInput();
    owner.setDirty(true); change(); setIssue(null); refreshOwner(revision => revision + 1);
    return true;
  };
  const input = (): SubmissionInput => ({ type, id: loadedId, direction, semitones, trillFret });
  const submit = async (coordinatorCurrent?: () => boolean, values = input(), explicitDirection = false): Promise<"applied" | "blocked" | "stale"> => {
    if (blocked || composition.isComposing() || !owner.canHide() || modals.isOpen()) return "blocked";
    if ((!slideChosen && values.type === type) || (!directionChosen && !explicitDirection && values.type === type)) {
      report("请明确选择技巧方向。"); return "blocked";
    }
    if (values.type === "trill" && (!Number.isInteger(values.trillFret) || values.trillFret < 0 || values.trillFret > 24)) {
      report("辅助品位须为 0–24 的整数。"); return "blocked";
    }
    if ((owner.isDirty() && currentInput.current && !currentInput.current()) || (coordinatorCurrent && !coordinatorCurrent())) {
      report("技巧目标或文档已变化，请重新选择技巧。"); return "stale";
    }
    const before = captureEditorToolIntent(session.getState, getActiveTarget);
    beforeAction?.();
    if (!before() || (owner.isDirty() && currentInput.current && !currentInput.current())) {
      report("技巧目标或文档已变化，请重新选择技巧。"); return "stale";
    }
    const state = session.getState();
    const reason = tabToolTargetReason(state, getActiveTarget());
    if (reason || !state.document) { report(reason ?? "当前没有乐谱。"); return "blocked"; }
    const target = resolveToolbarTechnique(state.document, state.selection, values.type, values, values.id);
    if (!target.ok) { report(target.message); return "blocked"; }
    const targetIsCurrent = captureEditorToolIntent(session.getState, getActiveTarget);
    const generation = owner.owner.generation;
    const isCurrent = () => owner.owner.generation === generation && targetIsCurrent();
    owner.setBusy(true); refreshOwner(revision => revision + 1);
    try {
      const outcome = await execute(values.id
        ? { type: C.UpdateTechnique, trackId: target.trackId, techniqueId: values.id, technique: target.draft }
        : { type: C.AddTechnique, trackId: target.trackId, technique: target.draft }, "modal", { owner: owner.owner, isCurrent, tabOnly: true });
      if (outcome.status !== "applied" && outcome.status !== "noop") {
        if (outcome.status !== "needs-impact") report(outcome.message);
        return outcome.status === "stale" ? "stale" : "blocked";
      }
      const live = session.getState();
      if (owner.owner.generation !== generation || live.document !== outcome.result.document ||
        JSON.stringify(live.selection) !== JSON.stringify(state.selection) || live.selectedTechniqueId !== state.selectedTechniqueId) {
        loadCurrent.current(live.selectedTechniqueId);
        report("目标或文档已变化，请重新选择技巧。"); return "stale";
      }
      owner.complete();
      const track = outcome.result.document.score.tracks.find(item => item.id === target.trackId);
      const previousIds = new Set(state.document.score.tracks.find(item => item.id === target.trackId)?.techniques.map(item => item.id));
      const created = values.id ? track?.techniques.find(item => item.id === values.id)
        : track?.techniques.find(item => !previousIds.has(item.id));
      const appliedId = created?.id ?? values.id;
      setLoadedId(appliedId); setSelectedTechniqueId(appliedId);
      setActive(true); setReplacing(false); setShortcut(null); setDirectionChosen(true); setSlideChosen(true);
      captureInput(); setIssue(null); setErrorMessage(null); onSuccess();
      return "applied";
    } finally { owner.setBusy(false); refreshOwner(revision => revision + 1); }
  };

  const chooseType = (candidate: ILXMTechniqueType) => {
    if (!handoffAllowed()) return;
    beforeAction?.();
    const state = session.getState();
    const reason = tabToolTargetReason(state, getActiveTarget());
    if (reason || !state.document) { report(reason ?? "当前没有乐谱。"); return; }
    const editingId = replacing || (selected?.type === candidate && loadedId === state.selectedTechniqueId) ? loadedId : null;
    const unavailable = toolbarTechniqueAvailability(state.document, state.selection, candidate, editingId);
    if (unavailable) { report(unavailable); return; }
    owner.reset();
    if (!editingId) setSelectedTechniqueId(null);
    setLoadedId(editingId); setType(candidate); setActive(true); setShortcut(null);
    setDirectionChosen(true); setSlideChosen(true); setIssue(null);
    captureInput(); owner.setDirty(true); refreshOwner(revision => revision + 1);
    onShowParameters();
    // Relationships display the exact core-supported endpoints before committing.
    if (!techniqueNeedsParameters(candidate) && !techniqueNeedsConnection(candidate))
      void submit(undefined, { ...input(), type: candidate, id: editingId });
  };

  useImperativeHandle(ref, () => ({
    canHide: owner.canHide, discard,
    openTechnique: intent => {
      if (!handoffAllowed()) return false;
      beforeAction?.();
      const state = session.getState();
      const reason = tabToolTargetReason(state, getActiveTarget());
      if (reason || !state.document) { report(reason ?? "当前没有乐谱。"); return false; }
      const candidate = resolveTechniqueDraft(state.document, state.selection, intent.type === "slide" ? "slideUp" : "arpeggio", undefined, true);
      if (!candidate.ok) { report(candidate.message); return false; }
      owner.reset(); setSelectedTechniqueId(null); setLoadedId(null); setActive(true); setReplacing(false);
      setType(intent.type === "slide" ? "slideUp" : "arpeggio"); setShortcut(intent.type);
      setSlideChosen(intent.type !== "slide"); setDirectionChosen(intent.type !== "arpeggio");
      captureInput(); owner.setDirty(true); setIssue(null); refreshOwner(revision => revision + 1);
      onShowParameters(); return true;
    },
  }));
  const remove = async () => {
    if (!handoffAllowed() || !loadedId || loadedId !== session.getState().selectedTechniqueId || !selected) return;
    beforeAction?.();
    const state = session.getState();
    if (loadedId !== state.selectedTechniqueId) return;
    const reason = tabToolTargetReason(state, getActiveTarget());
    if (reason) { report(reason); return; }
    const track = state.document?.score.tracks.find(item => item.techniques.some(value => value.id === loadedId));
    if (!track) return;
    owner.setBusy(true); refreshOwner(revision => revision + 1);
    const generation = owner.owner.generation;
    const targetIsCurrent = captureEditorToolIntent(session.getState, getActiveTarget);
    try {
      const outcome = await execute({ type: C.RemoveTechnique, trackId: track.id, techniqueId: loadedId }, "modal", {
        owner: owner.owner, tabOnly: true, isCurrent: () => generation === owner.owner.generation && targetIsCurrent(),
      });
      if (outcome.status === "applied" || outcome.status === "noop") {
        const live = session.getState();
        if (owner.owner.generation !== generation || live.document !== outcome.result.document ||
          JSON.stringify(live.selection) !== JSON.stringify(state.selection) ||
          (live.selectedTechniqueId !== null && live.selectedTechniqueId !== loadedId)) {
          loadCurrent.current(live.selectedTechniqueId); return;
        }
        owner.complete(); setSelectedTechniqueId(null); setLoadedId(null); setActive(false); setReplacing(false); setIssue(null); onSuccess();
      } else if (outcome.status !== "needs-impact") report(outcome.message);
    } finally { owner.setBusy(false); refreshOwner(revision => revision + 1); }
  };
  useLayoutEffect(() => {
    owner.register({ targetKey: inputTargetKey.current,
      inputKey: JSON.stringify({ type, direction, semitones, trillText, slideChosen, directionChosen }),
      version: inputVersion.current, focus, apply: ({ isCurrent }) => submit(isCurrent), discard });
    // The registration follows the current rendered input and its captured version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ownerRevision, selection, loadedId, type, direction, semitones, trillText, shortcut, slideChosen, directionChosen, blocked]);

  const targetDocument = owner.isDirty() ? boundTarget.document : document;
  const targetSelection = owner.isDirty() ? boundTarget.selection : selection;
  const connection = resolveToolbarTechnique(targetDocument, targetSelection, type, input(), loadedId);
  const noteSummary = (id: string) => {
    for (const track of targetDocument.score.tracks) for (const [measureIndex, measure] of track.measures.entries())
      for (const [beatIndex, beat] of measure.beats.entries()) {
        const note = beat.notes.find(item => item.id === id);
        if (note) return `第 ${measureIndex + 1} 小节第 ${beatIndex + 1} 拍 · 第 ${note.string} 弦 ${note.fret} 品`;
      }
    return "目标音符已失效";
  };
  const beatSummary = (id: string) => {
    for (const track of targetDocument.score.tracks) for (const [measureIndex, measure] of track.measures.entries()) {
      const index = measure.beats.findIndex(beat => beat.id === id);
      if (index >= 0) return `第 ${measureIndex + 1} 小节第 ${index + 1} 拍`;
    }
    return "目标拍点已失效";
  };
  const scope = (draft: ILXMTechniqueDraft) => "fromNoteId" in draft
    ? `${noteSummary(draft.fromNoteId)}${"toNoteId" in draft ? ` → ${noteSummary(draft.toNoteId)}` : ""}`
    : "beatId" in draft ? `${beatSummary(draft.beatId)}${"minString" in draft ? ` · 第 ${draft.minString}–${draft.maxString} 弦` : ""}`
      : `${beatSummary(draft.fromBeatId)} → ${beatSummary(draft.toBeatId)}`;
  const objects = techniquesInToolbarSelection(document, selection);
  const locked = blocked || !owner.canHandoff() || modals.isOpen();
  const globalReason = blocked ? "请先处理属性草稿。" : !owner.canHandoff() ? "请先完成当前输入或提交。"
    : modals.isOpen() ? "请先完成当前弹层操作。" : tabToolTargetReason(session.getState(), getActiveTarget());
  const deleteReason = globalReason ?? (!selected || loadedId !== selectedTechniqueId ? "请先指定要删除的一项技巧。" : null);
  const discrete = (values: Partial<TechniqueParameters>) => {
    if (!handoffAllowed()) return;
    if (changed(() => { if (values.direction) { setDirection(values.direction); setDirectionChosen(true); }
      if (values.semitones) setSemitones(values.semitones); }))
      void submit(undefined, { ...input(), ...values }, true);
  };
  const numberSubmit = (value: string) => {
    if (!owner.isDirty()) return;
    void submit(undefined, { ...input(), trillFret: parseTechniqueTrillFret(value) });
  };
  const selectObject = (id: string) => {
    if (!handoffAllowed()) return;
    beforeAction?.();
    const next = session.getState().document && resolveTechniqueSelection(session.getState().document!, id, "end");
    if (!next) { report("技巧对象已失效，请重新选择。"); return; }
    session.getState().setSelection(next); setSelectedTechniqueId(id); load(id);
  };
  const showParameters = active && (selected || replacing || techniqueNeedsParameters(type) || techniqueNeedsConnection(type));
  return <ConfigProvider getPopupContainer={node => node?.closest<HTMLElement>(".ant-popover, [data-tool-portal-domain]") ?? window.document.body}>
    <div className={styles.panel} aria-label="吉他技巧工具">
      <div className={styles.header}>
        <h3 className={styles.title}>所有技巧</h3>
        <div className={styles.actions}>
          <ShortcutTooltip shortcuts={["remove"]} note={deleteReason ?? undefined} disabled={!!deleteReason}>
            <Button className={styles.delete} type="text" danger icon={<DeleteOutlined />} aria-label="删除当前技巧"
              disabled={!!deleteReason} onClick={() => void remove()} />
          </ShortcutTooltip>
          {onClose && <Button className={styles.close} type="text" icon={<CloseOutlined />} aria-label="关闭所有技巧"
            disabled={!owner.canHide()} onClick={() => { if (discard()) onClose(); }} />}
        </div>
      </div>
      {TECHNIQUE_GROUPS.map(group => <section className={styles.group} key={group.label} aria-label={group.label}>
        <h4 className={styles.groupTitle}>{group.label}</h4>
        <div className={styles.grid}>{group.items.map(item => {
          const editingId = replacing || selected?.type === item.value ? loadedId : null;
          const reason = globalReason ?? toolbarTechniqueAvailability(document, selection, item.value, editingId);
          return <Tooltip key={item.value} title={reason ?? item.label}>
            <button type="button" className={styles.tile} data-technique-type={item.value}
              aria-label={reason ? `${item.label}：${reason}` : item.label} aria-disabled={!!reason}
              aria-pressed={active && type === item.value && (slideChosen || shortcut !== "slide")}
              onClick={() => { if (!reason) chooseType(item.value); }}>
              <span className={styles.icon}><TechniqueToolbarIcon type={item.value} /></span><span>{item.label}</span>
            </button>
          </Tooltip>;
        })}</div>
      </section>)}
      {objects.length > 0 && <div className={styles.objects} aria-label="选区中的技巧对象">
        {objects.map((item, index) => <Button key={item.id} size="small" type={loadedId === item.id ? "primary" : "default"}
          disabled={locked} aria-pressed={loadedId === item.id} onClick={() => selectObject(item.id)}>
          {label(item.type)}{objects.filter(value => value.type === item.type).length > 1 ? ` · ${index + 1}` : ""}
        </Button>)}
      </div>}
      {showParameters && <div ref={parameterRegion} className={styles.parameters} data-technique-parameters
        onCompositionStart={composition.start} onCompositionEnd={composition.end}
        onKeyDownCapture={event => {
          composition.observeKey(event.nativeEvent);
          if (!isEditorInputEnter(event) || (event.target as HTMLElement).tagName !== "INPUT") return;
          event.stopPropagation();
          if (composition.isComposing()) return;
          event.preventDefault();
          if (!event.repeat) numberSubmit((event.target as HTMLInputElement).value);
        }}>
        <div className={styles.parameterHeader}>
          <strong>{replacing ? `更换 ${selected ? label(selected.type) : "技巧"} 类型` : `${selected ? "正在编辑" : "新增"}：${label(type)}`}</strong>
          {selected && <Button size="small" type="text" disabled={locked} onClick={() => {
            if (!handoffAllowed()) return;
            setReplacing(!replacing); setIssue(null);
          }}>{replacing ? "取消更换" : "更换类型"}</Button>}
        </div>
        <p className={styles.scope}>{connection.ok ? scope(connection.draft) : connection.message}</p>
        {shortcut === "slide" && !slideChosen && <div className={styles.choices}>
          {(["slideUp", "slideDown"] as const).map(value => <button key={value} type="button" className={styles.choice}
            disabled={locked || !!toolbarTechniqueAvailability(document, selection, value, null)} onClick={() => chooseType(value)}>{label(value)}</button>)}
        </div>}
        {(type === "strum" || type === "arpeggio" || type === "pickStroke") && <div className={styles.choices} aria-label="技巧方向">
          {(["down", "up"] as const).map(value => <button key={value} type="button" className={styles.choice}
            disabled={locked} aria-pressed={directionChosen && direction === value} onClick={() => discrete({ direction: value })}>
            {type === "arpeggio" ? value === "down" ? "上行" : "下行" : value === "down" ? "向下" : "向上"}
          </button>)}
        </div>}
        {type === "bend" && <div className={styles.choices} aria-label="推弦幅度">
          {([1, 2] as const).map(value => <button key={value} type="button" className={styles.choice} disabled={locked}
            aria-pressed={semitones === value} onClick={() => discrete({ semitones: value })}>{value === 1 ? "半音" : "全音"}</button>)}
        </div>}
        {type === "trill" && <label className={styles.number}>辅助品位
          <Input aria-label="辅助品位" inputMode="numeric" value={trillText} disabled={!owner.canEdit() || blocked}
            onChange={event => changed(() => setTrillText(event.target.value))} onBlur={event => numberSubmit(event.target.value)} />
        </label>}
        {techniqueNeedsConnection(type) && slideChosen && <Button size="small" disabled={locked || !connection.ok}
          onClick={() => void submit()}>应用到此目标</Button>}
      </div>}
      {issue && <Alert className={styles.feedback} type="error" showIcon title={issue} />}
    </div>
  </ConfigProvider>;
};
