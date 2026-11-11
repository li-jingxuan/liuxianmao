"use client";
import { Alert, Button, ConfigProvider, InputNumber, Select } from "antd";
import { LXMScoreCommandEnum as C, type ILXMDocument, type ILXMTabCellSelection, type ILXMTechniqueType } from "@liuxianmao/lxm-editor";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { useEditorRuntime } from "../session/EditorSessionRuntime";
import { useEditorSessionStore } from "../../../stores/editor-store";
import { captureEditorVersion } from "../session/editor-session-version";
import { createTechniqueTypeController } from "./technique-type-controller";
import { TECHNIQUE_OPTIONS } from "./technique-catalog";
import { resolveTechniqueDraft, type TechniqueIntent } from "./editor-technique-target";
import { captureEditorToolIntent, tabToolTargetReason } from "./editor-tool-guard";
import { createTechniqueParameterOwner } from "./technique-parameter-owner";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";
import { isEditorInputEnter } from "../shared/editor-input-enter";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import editorFormStyles from "../shared/editor-form.module.scss";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";

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
  setSelectedTechniqueId: (id: string | null) => void;
  setErrorMessage: (message: string | null) => void;
}

/** One parameter owner survives menus and layout changes; shortcuts hand off an explicit create intent. */
export const TechniqueToolbar = ({ ref, document, selection, selectedTechniqueId, execute, blocked,
  beforeAction, getActiveTarget = () => null, onShowParameters, onSuccess,
  setSelectedTechniqueId, setErrorMessage }: TechniqueToolbarProps) => {
  const { modals, drafts } = useEditorRuntime();
  const session = useEditorSessionStore();
  const [owner] = useState(() => createTechniqueParameterOwner(drafts));
  const parameterRegion = useRef<HTMLDivElement>(null);
  const [ownerRevision, refreshOwner] = useState(0);
  const [composition] = useState(() => createScoreSettingsComposition((protectedInput) => {
    if (protectedInput) owner.compositionStart();
    else { owner.compositionEnd(); owner.releaseCompositionBuffer(); }
    refreshOwner((revision) => revision + 1);
  }));
  const [loadedId, setLoadedId] = useState(selectedTechniqueId);
  const initialSelected = document.score.tracks.flatMap((track) => track.techniques).find((item) => item.id === selectedTechniqueId);
  const [issue, setIssue] = useState<string | null>(null);
  const [type, setType] = useState<ILXMTechniqueType>(initialSelected?.type ?? "hammerOn");
  const [direction, setDirection] = useState<"down" | "up">(initialSelected?.type === "arpeggio"
    ? initialSelected.direction === "ascending" ? "down" : "up"
    : initialSelected?.type === "strum" || initialSelected?.type === "pickStroke" ? initialSelected.stroke : "down");
  const [semitones, setSemitones] = useState<1 | 2>(initialSelected?.type === "bend" ? initialSelected.semitones : 2);
  const [trillFret, setTrillFret] = useState(initialSelected?.type === "trill" ? initialSelected.auxiliaryFret : 7);
  const [shortcut, setShortcut] = useState<TechniqueIntent["type"] | null>(null);
  const [directionChosen, setDirectionChosen] = useState(true);
  const [slideChosen, setSlideChosen] = useState(true);
  const currentInput = useRef<(() => boolean) | null>(null);
  const [boundTarget, setBoundTarget] = useState({ document, selection });
  const inputTargetKey = useRef(JSON.stringify({ selection, selectedTechniqueId }));
  const inputVersion = useRef(captureEditorVersion(session.getState()));
  const report = (message: string) => { setIssue(message); setErrorMessage(message); };
  const focus = () => {
    onShowParameters();
    parameterRegion.current?.querySelector<HTMLElement>("input,button,[role=combobox]")?.focus();
    return true;
  };
  const selected = useMemo(() => document.score.tracks.flatMap((track) => track.techniques)
    .find((item) => item.id === loadedId) ?? null, [document, loadedId]);
  const captureInput = () => {
    currentInput.current = captureEditorToolIntent(session.getState, getActiveTarget);
    inputVersion.current = captureEditorVersion(session.getState());
    setBoundTarget({ document: session.getState().document!, selection: session.getState().selection });
    inputTargetKey.current = JSON.stringify({ selection: session.getState().selection, selectedTechniqueId: session.getState().selectedTechniqueId });
  };
  const load = (id: string | null) => {
    const value = session.getState().document?.score.tracks.flatMap((track) => track.techniques).find((item) => item.id === id);
    owner.reset();
    setLoadedId(id);
    setType(value?.type ?? "hammerOn");
    setDirection(value?.type === "arpeggio" ? value.direction === "ascending" ? "down" : "up"
      : value?.type === "strum" || value?.type === "pickStroke" ? value.stroke : "down");
    setSemitones(value?.type === "bend" ? value.semitones : 2);
    setTrillFret(value?.type === "trill" ? value.auxiliaryFret : 7);
    setShortcut(null); setDirectionChosen(true); setSlideChosen(true); setIssue(null);
    captureInput();
    refreshOwner((revision) => revision + 1);
  };
  const discard = () => {
    if (!owner.canHide()) return false;
    load(session.getState().selectedTechniqueId);
    return true;
  };
  const loadCurrent = useRef(load);
  useLayoutEffect(() => { loadCurrent.current = load; });
  // Session subscriptions distinguish actual target changes from pure visibility changes.
  useEffect(() => session.subscribe((next, previous) => {
    const boundary = next.sessionId !== previous.sessionId || next.sessionVersion !== previous.sessionVersion;
    if (boundary || ((next.selection !== previous.selection || next.selectedTechniqueId !== previous.selectedTechniqueId) && owner.canHandoff()))
      loadCurrent.current(next.selectedTechniqueId);
  }), [owner, session]);
  useEffect(() => () => {
    composition.dispose();
    owner.dispose();
  }, [composition, owner]);
  const changed = (change: () => void) => {
    if (!owner.canEdit()) return;
    if (!owner.isDirty()) captureInput();
    owner.setDirty(true); change(); setIssue(null); refreshOwner((revision) => revision + 1);
  };
  const handoffAllowed = () => {
    if (blocked) { report("请先处理属性草稿并选择有效 TAB 目标。"); return false; }
    if (modals.isOpen()) { report("请先完成当前弹层操作。"); return false; }
    if (!owner.canHandoff()) { report("请先完成当前输入或提交。"); focus(); return false; }
    return true;
  };
  useImperativeHandle(ref, () => ({
    canHide: owner.canHide,
    discard,
    openTechnique: (intent) => {
      if (!handoffAllowed()) return false;
      beforeAction?.();
      const state = session.getState();
      const reason = tabToolTargetReason(state, getActiveTarget());
      if (reason) { report(reason); return false; }
      const candidate = resolveTechniqueDraft(state.document!, state.selection, intent.type === "slide" ? "slideUp" : "arpeggio");
      if (!candidate.ok) { report(candidate.message); return false; }
      owner.reset();
      setLoadedId(null); setSelectedTechniqueId(null);
      setType(intent.type === "slide" ? "slideUp" : "arpeggio");
      setShortcut(intent.type);
      setSlideChosen(intent.type !== "slide");
      setDirectionChosen(intent.type !== "arpeggio");
      captureInput(); owner.setDirty(true);
      setIssue(null); refreshOwner((revision) => revision + 1);
      onShowParameters();
      return true;
    },
  }));

  const chooseType = (create: boolean) => {
    if (!handoffAllowed()) return;
    beforeAction?.();
    const state = session.getState();
    const current = captureEditorToolIntent(session.getState, getActiveTarget);
    const reason = (candidate: ILXMTechniqueType) => {
      const tabReason = tabToolTargetReason(session.getState(), getActiveTarget());
      if (tabReason) return tabReason;
      const target = resolveTechniqueDraft(state.document!, state.selection, candidate);
      return target.ok ? null : target.message;
    };
    const picker = createTechniqueTypeController(type, reason);
    let handedOff = false;
    let handoffIsCurrent = current;
    modals.open({ kind: "technique-type", title: create ? "添加弹奏技巧" : "更改技巧类型", message: "",
      picker, version: captureEditorVersion(state), isValid: current,
      confirm: ({ isCurrent }) => {
        if (!isCurrent() || !current() || reason(picker.getSnapshot())) return false;
        owner.reset();
        if (create) { setLoadedId(null); setSelectedTechniqueId(null); }
        setType(picker.getSnapshot()); setShortcut(null); setDirectionChosen(true); setSlideChosen(true);
        captureInput(); owner.setDirty(true); refreshOwner((revision) => revision + 1);
        handoffIsCurrent = captureEditorToolIntent(session.getState, getActiveTarget);
        handedOff = true; return true;
      },
      afterClose: () => { if (handedOff && handoffIsCurrent()) { onShowParameters(); return true; } return false; },
    });
  };
  const submit = async (coordinatorCurrent?: () => boolean, enteredTrillFret = trillFret): Promise<"applied" | "blocked" | "stale"> => {
    if (blocked || composition.isComposing() || !owner.canHide() || modals.isOpen()) return "blocked";
    if (!slideChosen || !directionChosen) { report("请明确选择技巧方向。"); return "blocked"; }
    if (type === "trill" && (!Number.isInteger(enteredTrillFret) || enteredTrillFret < 0 || enteredTrillFret > 24)) {
      report("辅助品位须为 0–24 的整数。"); return "blocked";
    }
    if ((owner.isDirty() && currentInput.current && !currentInput.current()) ||
      (coordinatorCurrent && !coordinatorCurrent())) {
      report("技巧目标或文档已变化，请关闭参数面板后重新操作。"); return "stale";
    }
    beforeAction?.();
    const state = session.getState();
    const reason = tabToolTargetReason(state, getActiveTarget());
    if (reason || !state.document) { report(reason ?? "当前没有乐谱。"); return "blocked"; }
    const target = resolveTechniqueDraft(state.document, state.selection, type, { direction, semitones, trillFret: enteredTrillFret });
    if (!target.ok) { report(target.message); return "blocked"; }
    const targetIsCurrent = captureEditorToolIntent(session.getState, getActiveTarget);
    const generation = owner.owner.generation;
    const isCurrent = () => owner.owner.generation === generation && targetIsCurrent();
    owner.setBusy(true); refreshOwner((revision) => revision + 1);
    try {
      const outcome = await execute(loadedId
        ? { type: C.UpdateTechnique, trackId: target.trackId, techniqueId: loadedId, technique: target.draft }
        : { type: C.AddTechnique, trackId: target.trackId, technique: target.draft }, "modal", { owner: owner.owner, isCurrent, tabOnly: true });
      if (outcome.status !== "applied" && outcome.status !== "noop") {
        if (outcome.status !== "needs-impact") report(outcome.message);
        return outcome.status === "stale" ? "stale" : "blocked";
      }
      owner.complete();
      if (outcome.result.changed && !loadedId) {
        const techniques = outcome.result.document.score.tracks.find((track) => track.id === target.trackId)?.techniques;
        const draft = target.draft;
        const created = draft.type === "strum" || draft.type === "arpeggio"
          ? techniques?.find((item) => item.type === draft.type && "beatId" in item && item.beatId === draft.beatId)
          : techniques?.at(-1);
        if (created) { setLoadedId(created.id); setSelectedTechniqueId(created.id); }
      }
      captureInput(); setIssue(null); onSuccess(); return "applied";
    } finally { owner.setBusy(false); refreshOwner((revision) => revision + 1); }
  };
  const remove = async () => {
    if (blocked || !owner.canHide() || !loadedId || !selected || modals.isOpen()) return;
    beforeAction?.();
    const state = session.getState();
    const reason = tabToolTargetReason(state, getActiveTarget());
    if (reason) { report(reason); return; }
    const track = state.document?.score.tracks.find((item) => item.techniques.some((value) => value.id === loadedId));
    if (!track) return;
    owner.setBusy(true); refreshOwner((revision) => revision + 1);
    const generation = owner.owner.generation;
    const targetIsCurrent = captureEditorToolIntent(session.getState, getActiveTarget);
    try {
      const outcome = await execute({ type: C.RemoveTechnique, trackId: track.id, techniqueId: loadedId }, "modal", {
        owner: owner.owner, tabOnly: true, isCurrent: () => generation === owner.owner.generation && targetIsCurrent(),
      });
      if (outcome.status === "applied" || outcome.status === "noop") { owner.reset(); setSelectedTechniqueId(null); setLoadedId(null); onSuccess(); }
    } finally { owner.setBusy(false); refreshOwner((revision) => revision + 1); }
  };
  useLayoutEffect(() => {
    owner.register({ targetKey: inputTargetKey.current,
      inputKey: JSON.stringify({ type, direction, semitones, trillFret, slideChosen, directionChosen }),
      version: inputVersion.current, focus, apply: ({ isCurrent }) => submit(isCurrent), discard });
    // Registration callbacks deliberately follow the latest rendered owner input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ownerRevision, selection, loadedId, type, direction, semitones, trillFret, shortcut, slideChosen, directionChosen, blocked]);
  const connection = resolveTechniqueDraft(owner.isDirty() ? boundTarget.document : document,
    owner.isDirty() ? boundTarget.selection : selection, type, { direction, semitones, trillFret });
  const targetDocument = owner.isDirty() ? boundTarget.document : document;
  const noteSummary = (id: string) => {
    for (const track of targetDocument.score.tracks) {
      for (const [measureIndex, measure] of track.measures.entries()) {
        for (const [beatIndex, beat] of measure.beats.entries()) {
          const note = beat.notes.find((item) => item.id === id);
          if (note) return `第 ${measureIndex + 1} 小节第 ${beatIndex + 1} 拍 · 第 ${note.string} 弦 ${note.fret === "x" ? "x 弹奏标记" : note.fret === "-" ? "- 延音标记" : `${note.fret} 品`}`;
        }
      }
    }
    return "目标音符已失效";
  };
  const beatSummary = (id: string) => {
    for (const track of targetDocument.score.tracks) {
      for (const [measureIndex, measure] of track.measures.entries()) {
        const index = measure.beats.findIndex((beat) => beat.id === id);
        if (index >= 0) return `第 ${measureIndex + 1} 小节第 ${index + 1} 拍`;
      }
    }
    return "目标拍点已失效";
  };
  return <ConfigProvider getPopupContainer={(node) => node?.closest<HTMLElement>(".ant-popover, [data-tool-portal-domain]") ?? window.document.body}>
    <div className={editorToolPanelStyles.toolMenu} aria-label="吉他技巧工具">
    <Button data-tool-action="technique-actions" block onClick={() => chooseType(true)}>新增技巧：选择全部 16 类…</Button>
    {selected && <Button block onClick={() => chooseType(false)}>更改当前技巧类型…</Button>}
    <div ref={parameterRegion} className={editorToolPanelStyles.toolMenu} data-technique-parameters
      onCompositionStart={composition.start} onCompositionEnd={composition.end}
      onKeyDownCapture={(event) => {
        composition.observeKey(event.nativeEvent);
        if (!isEditorInputEnter(event)) return;
        if (composition.isComposing()) { event.stopPropagation(); return; }
        // Capture before InputNumber normalizes/clamps Enter, so invalid typed values
        // reach the same domain validation as the add/update action.
        event.preventDefault(); event.stopPropagation();
        if (event.repeat || !selection || !slideChosen || !directionChosen) return;
        const value = (event.target as HTMLInputElement).value.trim();
        void submit(undefined, value ? Number(value) : Number.NaN);
      }}>
      <label className={editorToolPanelStyles.toolbarField}><span>技巧</span>
        <Select style={{ minWidth: 110 }} aria-label="选择吉他技巧" value={shortcut === "slide" && !slideChosen ? undefined : type}
          placeholder={shortcut === "slide" ? "请选择上滑／下滑" : undefined}
          onChange={(value) => {
            if (shortcut === "slide") changed(() => { setType(value as ILXMTechniqueType); setSlideChosen(true); });
            else if (owner.canHandoff()) changed(() => setType(value as ILXMTechniqueType));
            else report("请先完成当前输入或提交，再切换类型。");
          }} options={TECHNIQUE_OPTIONS.filter((option) => shortcut !== "slide" || option.value === "slideUp" || option.value === "slideDown")
            .map((option) => ({ value: option.value, label: option.label }))} />
      </label>
      {(type === "strum" || type === "arpeggio" || type === "pickStroke") && <label className={editorToolPanelStyles.toolbarField}>
        <span>{type === "arpeggio" ? "音高方向" : "演奏方向"}</span>
        <Select style={{ minWidth: 110 }} aria-label="选择技巧方向" value={directionChosen ? direction : undefined} placeholder="请选择方向"
          onChange={(value) => changed(() => { setDirection(value as "down" | "up"); setDirectionChosen(true); })}
          options={[{ value: "down", label: type === "arpeggio" ? "上行" : "下" }, { value: "up", label: type === "arpeggio" ? "下行" : "上" }]} />
      </label>}
      {type === "bend" && <label>推弦幅度<Select aria-label="推弦幅度" value={semitones}
        onChange={(value) => changed(() => setSemitones(Number(value) as 1 | 2))} options={[{ value: 1, label: "半音" }, { value: 2, label: "全音" }]} /></label>}
      {type === "trill" && <label className={editorToolPanelStyles.toolbarField}><span>辅助品位</span>
        <InputNumber aria-label="辅助品位" style={{ width: 88 }} min={0} max={24} value={Number.isFinite(trillFret) ? trillFret : null}
          onChange={(value) => changed(() => setTrillFret(value ?? Number.NaN))} changeOnBlur={false} />
      </label>}
      {shortcut && <p role="status" data-editor-form-hint className={editorFormStyles.settingsHint}>{connection.ok
        ? "toNoteId" in connection.draft ? `连接：${noteSummary(connection.draft.fromNoteId)} → ${noteSummary(connection.draft.toNoteId)}`
          : "minString" in connection.draft ? `${beatSummary(connection.draft.beatId)}；第 ${connection.draft.minString}–${connection.draft.maxString} 弦` : ""
        : connection.message}</p>}
      <Button htmlType="button" size="middle" disabled={blocked || !selection || !slideChosen || !directionChosen ||
        (type === "trill" && (!Number.isInteger(trillFret) || trillFret < 0 || trillFret > 24))} onClick={() => void submit()}>
        {loadedId ? "应用更改" : "添加技巧"}
      </Button>
      <Button htmlType="button" size="middle" disabled={blocked || !loadedId} onClick={() => void remove()}>删除技巧</Button>
      {issue && <Alert type="error" showIcon title={issue} />}
      {type === "trill" && (!Number.isInteger(trillFret) || trillFret < 0 || trillFret > 24) && <Alert type="error" showIcon title="辅助品位须为 0–24 的整数。" />}
      {selected && <span className={editorToolPanelStyles.techniqueSelectionLabel}>已选：{TECHNIQUE_OPTIONS.find((item) => item.value === selected.type)?.label ?? selected.type}</span>}
    </div>
  </div></ConfigProvider>;
};
