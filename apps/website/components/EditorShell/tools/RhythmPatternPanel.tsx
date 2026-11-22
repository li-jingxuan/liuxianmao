"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEventHandler, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, Tooltip } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import {
  getBeatStrumRhythmPatternTemplates,
  getMeasureRhythmPatternTemplates,
  getRhythmPatternMeasureRanges,
  getRhythmPatternTemplates,
  inferBeatStrumRhythmPatternTemplate,
  inferRhythmPatternTemplate,
  LXMScoreCommandEnum,
  planRhythmPattern,
  TICKS_PER_QUARTER,
  type BeatStrumRhythmPatternTemplate,
  type ILXMDocument,
  type MeasureRhythmPatternTemplate,
  type RhythmPatternTemplate,
  type RhythmPatternTarget,
} from "@liuxianmao/lxm-editor";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../../stores/editor-store";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { captureEditorVersion, sameEditorVersion } from "../session/editor-session-version";
import type { resolveEditorRhythmPatternTarget } from "./editor-rhythm-pattern-target";
import styles from "./RhythmPatternPanel.module.scss";

type TargetResult = ReturnType<typeof resolveEditorRhythmPatternTarget>;
type TemplateTab = "rhythm" | "strum";
type AppliedStrum = { entryId: string; templateId: string; scope: RhythmPatternTarget };
const templateTabs = [
  { id: "rhythm", label: "普通节奏型" },
  { id: "strum", label: "扫弦节奏型" },
] as const;
const collapsedStrumCount = 6;
export interface RhythmPatternConfig {
  session: StoreApi<EditorStoreState>;
  document: ILXMDocument;
  targetResult: TargetResult;
  targetIdentity: string;
  getTargetResult: () => TargetResult;
  getTargetIdentity: () => string;
  execute: EditorCommandAdapter;
  beforeAction: () => void;
  blocked: boolean;
  getBlocked: () => boolean;
  onSuccess: (scope: RhythmPatternTarget) => void;
  onScopeChange?: (scope: RhythmPatternTarget | null) => void;
  onOpenSidebar?: () => boolean;
  onUndo?: () => boolean;
  onBusyChange: (busy: boolean) => void;
}
interface Props extends RhythmPatternConfig {
  onClose: () => void;
  presentation?: "toolbar" | "sidebar";
  visible?: boolean;
  onHandoff?: () => void;
}

const templatesFor = (document: ILXMDocument, result: TargetResult) => {
  const track = result.ok && document.score.tracks.find(item => item.id === result.target.trackId);
  const ranges = result.ok && track ? getRhythmPatternMeasureRanges(track, result.target) : [];
  const signature = ranges[0]?.measure.timeSignature ?? document.score.tracks[0]?.measures[0]?.timeSignature ?? { numerator: 4, denominator: 4 };
  const candidates = getRhythmPatternTemplates(signature);
  const beats = candidates.filter(template => ranges.every(range => getRhythmPatternTemplates(range.measure.timeSignature).some(item => item.id === template.id)));
  const strums = result.ok && result.target.layer === "tab" && ranges.length === 1
    ? getBeatStrumRhythmPatternTemplates(signature)
    : [];
  const signatures = [...new Set(ranges.map(({ measure }) => `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`))];
  return {
    ranges,
    signatures: signatures.length ? signatures.join("、") : `${signature.numerator}/${signature.denominator}`,
    beats,
    strums,
    measures: signatures.length <= 1 ? getMeasureRhythmPatternTemplates(signature) : [],
  };
};
const previewFor = (props: RhythmPatternConfig, explicitTemplateId?: string) => {
  const state = props.session.getState();
  // Render 以本次 props 为准：实时 getter 的 ref 要到 layout effect 才更新，
  // 不能在同次 render 的选区刷新中读取它们。getter 仅用于提交瞬时保护。
  const targetResult = props.targetResult;
  const templates = state.document ? templatesFor(state.document, targetResult) : undefined;
  const inferred = explicitTemplateId === undefined && state.document && targetResult.ok
    ? inferRhythmPatternTemplate(state.document, targetResult.target) : null;
  const selected = explicitTemplateId !== undefined
    ? templates?.beats.find((item) => item.id === explicitTemplateId) ?? templates?.measures.find((item) => item.id === explicitTemplateId) ??
      templates?.strums.find((item) => item.id === explicitTemplateId)
    : templates?.beats.find(item => item.id === inferred?.id);
  return {
    session: props.session,
    version: captureEditorVersion(state),
    identity: props.targetIdentity,
    targetResult,
    // 手选只属于本次目标与文档快照，目标或文档变化后重新识别。
    templateId: selected?.id,
    templateName: selected?.name,
    result: state.document && targetResult.ok && selected
      ? planRhythmPattern(state.document, targetResult.target, selected.id)
      : { ok: false as const, code: "INVALID_TARGET", message: !targetResult.ok ? targetResult.message
        : !templates?.beats.length ? (templates?.ranges.length ?? 0) > 1
          ? `所选小节没有共同的拍内模板：${templates!.ranges.map(({ measure, index }) => `第 ${index + 1} 小节 ${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`).join("、")}。`
          : "当前拍号暂无可用的节奏型。" : "当前拍未匹配到节奏型，请选择模板。" },
  };
};

/** 一个 Provider 对应一个编辑会话；两处入口共享快照和同步提交锁。 */
function useRhythmPatternController(props: RhythmPatternConfig, enabled = true) {
  const { session, document, targetResult, onScopeChange, onBusyChange } = props;
  const current = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [visiblePanels, setVisiblePanels] = useState(0);
  const [selection, setSelection] = useState(() => ({
    tab: "rhythm" as TemplateTab,
    rhythm: enabled ? previewFor(props) : null,
    strum: null as ReturnType<typeof previewFor> | null,
    lastStrum: null as AppliedStrum | null,
  }));
  const templates = useMemo(() => templatesFor(document, targetResult), [document, targetResult]);
  const tab = templates.strums.length ? selection.tab : "rhythm";
  const snapshot = selection.rhythm ?? previewFor(props);
  const changed = snapshot.session !== session || !sameEditorVersion(current, snapshot.version) || snapshot.identity !== props.targetIdentity;
  // 在本次 render 即使用新快照，避免旧拍的手选和预览短暂显示在新选区上。
  const rhythmPreview = changed ? previewFor(props) : snapshot;
  const strumPreview = changed ? null : selection.strum;
  const preview = (tab === "strum" && strumPreview) || rhythmPreview;
  if (enabled && changed) setSelection({ ...selection, rhythm: rhythmPreview, strum: null });
  const [failure, setFailure] = useState<string | null>(null);
  if (enabled && changed && failure !== null) setFailure(null);
  const [busy, setBusy] = useState(false);
  const [sidebarFocus, setSidebarFocus] = useState(0);
  const { lastStrum } = selection;
  const [expansion, setExpansion] = useState({
    toolbar: { beat: false, measure: false, strum: false },
    sidebar: { beat: false, measure: false, strum: false },
  });
  const busyRef = useRef(false);
  const generation = useRef(0);
  const previewGeneration = generation.current;
  const succeeded = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const stale = preview.session !== session || !sameEditorVersion(current, preview.version) || preview.identity !== props.targetIdentity;
  const activeStrum = enabled && tab === "strum" && targetResult.ok
    ? inferBeatStrumRhythmPatternTemplate(document, targetResult.target) : null;
  const draft = tab === "strum" ? strumPreview : rhythmPreview;
  const plan = draft?.result.ok ? draft.result : null;
  const strumBeatIndex = tab === "strum" && targetResult.ok ? Math.floor(targetResult.target.focusTick / TICKS_PER_QUARTER) : null;
  const strumScope = activeStrum && strumBeatIndex !== null && targetResult.ok
    ? { ...targetResult.target, startTick: strumBeatIndex * TICKS_PER_QUARTER, endTick: (strumBeatIndex + 1) * TICKS_PER_QUARTER }
    : null;
  const scope = tab === "rhythm" ? plan?.target : visiblePanels > 0 ? plan?.target ?? strumScope : null;
  const scopeKey = scope && !stale ? JSON.stringify(scope) : null;
  const undoEntry = strumScope && activeStrum && !strumPreview && lastStrum?.templateId === activeStrum.id &&
    lastStrum.scope.trackId === strumScope.trackId && lastStrum.scope.measureId === strumScope.measureId &&
    lastStrum.scope.startTick === strumScope.startTick && current.pastEntries.at(-1)?.id === lastStrum.entryId
    ? lastStrum.entryId : null;
  useEffect(() => {
    if (!enabled) return;
    onScopeChange?.(scopeKey ? JSON.parse(scopeKey) as RhythmPatternTarget : null);
  }, [scopeKey, onScopeChange, enabled]);
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!succeeded.current) latest.current.onScopeChange?.(null);
      latest.current.onBusyChange(false);
    };
  }, [enabled]);
  // 连续选区也可能由 Shell 管理，需与会话版本一起校验。
  const isPreviewCurrent = (candidate: typeof preview) => {
    const now = latest.current;
    return mounted.current && generation.current === previewGeneration && now.session === candidate.session &&
      sameEditorVersion(now.session.getState(), candidate.version) && now.getTargetIdentity() === candidate.identity;
  };
  const selectTab = (next: TemplateTab) => {
    if (next === tab || busyRef.current) return;
    generation.current += 1;
    setSelection((current) => ({ ...current, tab: next }));
    setFailure(null);
  };
  const refresh = (templateId: string) => {
    if (busyRef.current || !isPreviewCurrent(preview)) return;
    generation.current += 1;
    const next = tab === "strum" && activeStrum?.id === templateId ? null : previewFor(latest.current, templateId);
    setSelection((current) => ({ ...current, [tab]: next }));
    setFailure(null);
  };
  const cancelStrum = () => {
    if (busyRef.current) return;
    generation.current += 1;
    setSelection((current) => ({ ...current, strum: null }));
    setFailure(null);
  };
  const apply = async (onApplied?: (scope: RhythmPatternTarget) => void, onStrumApplied?: () => void, onFailure?: () => void) => {
    const candidate = preview;
    const plan = candidate.result.ok ? candidate.result : null;
    const isCandidateCurrent = () => isPreviewCurrent(candidate);
    const isCurrent = () => isCandidateCurrent() && !latest.current.blocked && !latest.current.getBlocked();
    if (busyRef.current || !plan || !draft || (tab === "strum" && !plan.changed) || !isCurrent()) return;
    setFailure(null);
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const confirmImpact = tab === "rhythm" && (plan.discardedTextCount > 0 || plan.requiresConfirmation);
      if (!confirmImpact) latest.current.beforeAction();
      if (!isCurrent()) return;
      const result = await latest.current.execute({
        type: LXMScoreCommandEnum.ApplyRhythmPattern,
        // 版本与确认键绑定提交瞬时快照；只授权移除本次预览列出的标记。
        target: candidate.targetResult.ok ? candidate.targetResult.target : plan.target,
        templateId: plan.template.id,
        expectedConfirmationKey: plan.confirmationKey,
        allowRemoveMarks: plan.removedMarks.length > 0,
      }, confirmImpact ? "modal" : "caller", { isCurrent: confirmImpact ? isCandidateCurrent : isCurrent });
      if (!mounted.current) return;
      if (result.status === "applied" || result.status === "noop") {
        succeeded.current = true;
        generation.current += 1;
        if (tab === "strum") {
          const now = candidate.session.getState();
          const entryId = now.pastEntries.at(-1)?.id;
          const lastStrum = result.status === "applied" && now.document === result.result.document && entryId
            ? { entryId, templateId: plan.template.id, scope: plan.target } : null;
          setSelection((current) => ({ ...current, strum: null, lastStrum }));
          onStrumApplied?.();
          return;
        }
        // 先同步释放 busy 保护，再关闭浮层回焦；否则 Host 会把成功关闭当作忙碌中操作。
        busyRef.current = false;
        onBusyChange(false);
        // Host 同时读取共享 busy；提交更新后再调用成功关闭，不能被自己的锁阻挡。
        flushSync(() => setBusy(false));
        latest.current.onSuccess(plan.target);
        onApplied?.(plan.target);
        return;
      }
      if (result.status === "cancelled") return;
      setFailure("message" in result ? result.message : result.result.message);
      onFailure?.();
    } catch {
      if (mounted.current) setFailure("应用失败，请重试。");
    } finally {
      busyRef.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  };
  const openSidebar = () => {
    if (busyRef.current || !latest.current.onOpenSidebar?.()) return false;
    setSidebarFocus(value => value + 1);
    return true;
  };
  const undoStrum = undoEntry && props.onUndo ? () => {
    const now = latest.current;
    return !busyRef.current && !now.blocked && !now.getBlocked() && isPreviewCurrent(preview) &&
      now.session.getState().pastEntries.at(-1)?.id === undoEntry && !!now.onUndo?.();
  } : null;
  return { draft, plan, templates, tab, selectTab, stale, failure, busy, refresh, apply, cancelStrum, expansion, setExpansion,
    activeStrum, strumBeatIndex, setVisiblePanels, sidebarFocus, openSidebar, undoStrum };
}

type Controller = ReturnType<typeof useRhythmPatternController>;
const RhythmPatternContext = createContext<{ config: RhythmPatternConfig; controller: Controller } | null>(null);

export function useSharedRhythmPatternBusy(): boolean {
  return useContext(RhythmPatternContext)?.controller.busy ?? false;
}

export function RhythmPatternProvider({ children, ...config }: RhythmPatternConfig & { children: ReactNode }) {
  const controller = useRhythmPatternController(config);
  return <RhythmPatternContext.Provider value={{ config, controller }}>{children}</RhythmPatternContext.Provider>;
}

/** 侧栏只消费根会话的真实目标与命令路径，不自行解析另一个目标。 */
export function SidebarRhythmPatternPanel({ visible = true }: { visible?: boolean }) {
  const shared = useContext(RhythmPatternContext);
  return shared ? <RhythmPatternPanel {...shared.config} presentation="sidebar" visible={visible} onClose={() => {}} /> : null;
}

/** 不提供 Provider 的既有调用仍保持独立面板兼容。 */
export function RhythmPatternPanel(props: Props) {
  const shared = useContext(RhythmPatternContext);
  const local = useRhythmPatternController(shared?.config ?? props, !shared);
  const { draft, plan, templates, tab, selectTab, stale, failure, busy, refresh, apply, cancelStrum, expansion, setExpansion,
    activeStrum, strumBeatIndex, setVisiblePanels, sidebarFocus, openSidebar, undoStrum } = shared?.controller ?? local;
  const { blocked, targetResult, onOpenSidebar } = shared?.config ?? props;
  const presentation = props.presentation ?? "toolbar";
  const sidebar = presentation === "sidebar";
  const strum = tab === "strum";
  const hasTabs = templates.strums.length > 0;
  const visible = props.visible !== false && targetResult.ok;
  useLayoutEffect(() => {
    if (!visible) return;
    setVisiblePanels((count) => count + 1);
    return () => setVisiblePanels((count) => count - 1);
  }, [visible, setVisiblePanels]);
  const panel = useRef<HTMLElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);
  const handledSidebarFocus = useRef(0);
  useEffect(() => {
    if (!sidebar || !visible || sidebarFocus === handledSidebarFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const section = panel.current?.querySelector<HTMLElement>("[data-rhythm-tabs] [aria-selected='true']");
      if (!section || section.closest("[hidden], [inert]")) return;
      handledSidebarFocus.current = sidebarFocus;
      section.focus({ preventScroll: true });
      section.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [sidebar, sidebarFocus, visible]);
  const expanded = expansion[presentation];
  const templateGroupId = useId();
  const tabId = (tab: TemplateTab) => `${templateGroupId}-tab-${tab}`;
  const paneId = (tab: TemplateTab) => `${templateGroupId}-pane-${tab}`;
  const handleTabKey: KeyboardEventHandler<HTMLButtonElement> = (event) => {
    const key = event.key;
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const next = key === "Home" ? "rhythm" : key === "End" ? "strum" : strum ? "rhythm" : "strum";
    selectTab(next);
    panel.current?.querySelector<HTMLElement>(`[data-rhythm-tab="${next}"]`)?.focus({ preventScroll: true });
  };
  const firstExtra = (columns: number) => Math.max(0, Math.ceil(templates.beats.length / columns) - 2) * columns;
  const hasCollapsedMeasures = templates.measures.some((template) => template.collapsed);
  const toggle = (group: "beat" | "measure" | "strum") => {
    const title = group === "beat" ? "拍内模板" : group === "measure" ? "整小节模板" : "扫弦模板";
    const label = expanded[group] ? `收起${title}` : group === "strum" ? "展开全部" : `展开${title}`;
    return <button type="button" className={styles.toggle} disabled={busy}
      aria-expanded={expanded[group]} aria-controls={`${templateGroupId}-${group}`} data-rhythm-toggle={group}
      onClick={(event) => {
        const button = event.currentTarget;
        const extraSelector = group === "measure" ? "[data-extra]" : group === "strum" ? "[data-strum-template][hidden]" : null;
        const firstExtra = extraSelector && !expanded[group]
          ? button.previousElementSibling?.querySelector<HTMLElement>(extraSelector) : null;
        setExpansion((current) => ({
          ...current,
          [presentation]: { ...current[presentation], [group]: !current[presentation][group] },
        }));
        requestAnimationFrame(() => {
          const focus = firstExtra ?? button;
          focus.focus({ preventScroll: true });
          focus.scrollIntoView({ block: "nearest" });
        });
      }}>
      {label} <span aria-hidden="true">{expanded[group] ? "▴" : "▾"}</span>
    </button>;
  };
  const hasSharedController = shared !== null;
  const onBusyChange = props.onBusyChange;
  useEffect(() => {
    if (!hasSharedController || sidebar) return;
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [hasSharedController, sidebar, busy, onBusyChange]);
  if (!targetResult.ok) return null;
  const message = failure ?? (draft && !draft.result.ok ? draft.result.message
    : blocked ? "请先完成当前编辑，再应用节奏型；可继续浏览模板。" : null);
  const discardedCount = plan?.perBeat.reduce((total, beat) => total + beat.discardedCount, 0) ?? 0;
  const firstMeasure = templates.ranges[0];
  const lastMeasure = templates.ranges.at(-1);
  let destination: string | undefined;
  if (firstMeasure && strumBeatIndex !== null) {
    destination = `第 ${firstMeasure.index + 1} 小节 · 第 ${strumBeatIndex + 1} 拍`;
  } else if (plan && firstMeasure && lastMeasure) {
    if ("beats" in plan.template) {
      const numbers = firstMeasure === lastMeasure ? `${firstMeasure.index + 1}` : `${firstMeasure.index + 1}–${lastMeasure.index + 1}`;
      destination = `第 ${numbers} 小节 · 整小节`;
    } else if (firstMeasure !== lastMeasure) {
      destination = `第 ${firstMeasure.index + 1} 小节第 ${plan.scope.firstBeat} 拍至第 ${lastMeasure.index + 1} 小节第 ${plan.scopes.at(-1)!.lastBeat} 拍`;
    } else {
      const { beatCount, firstBeat, lastBeat } = plan.scope;
      const beats = beatCount === 1 ? `${firstBeat}` : `${firstBeat}–${lastBeat}`;
      destination = `第 ${firstMeasure.index + 1} 小节 · 第 ${beats} 拍`;
    }
  }
  const canApply = !busy && !blocked && !stale && !!plan && (!strum || plan.changed);
  const focusStrumResult = () => {
    const root = panel.current;
    if (!root) return;
    requestAnimationFrame(() => {
      if (panel.current !== root || root.closest("[inert], [hidden]")) return;
      const selected = root.querySelector<HTMLElement>('[data-strum-template][aria-pressed="true"]:not([hidden])');
      const focus = selected ?? (root.querySelector('[data-strum-template][aria-pressed="true"]')
        ? root.querySelector<HTMLElement>('[data-rhythm-toggle="strum"]') : root.querySelector<HTMLElement>('[data-rhythm-tab="strum"]'));
      focus?.focus({ preventScroll: true });
      focus?.scrollIntoView({ block: "nearest" });
    });
  };
  const applyCurrent = () => void apply(shared && !sidebar ? props.onSuccess : undefined, focusStrumResult,
    () => requestAnimationFrame(() => applyButton.current?.focus({ preventScroll: true })));
  const handleEnter: KeyboardEventHandler<HTMLElement> = (event) => {
    if (event.key !== "Enter" || event.defaultPrevented || !(event.target instanceof Element) ||
      !event.currentTarget.contains(event.target)) return;
    const target = event.target;
    const card = target.closest("[data-rhythm-template], [data-rhythm-measure-template], [data-strum-template]");
    const applyControl = target.closest("[data-rhythm-apply]");
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if ((card || applyControl) && (event.repeat || composing)) {
      event.preventDefault();
      return;
    }
    if (strum) return;
    // 未选卡片和应用按钮仍走原生 click，其他交互控件保留自己的键盘行为。
    if (card ? card.getAttribute("aria-pressed") !== "true" :
      target.closest('button, a[href], input, select, textarea, [contenteditable], [role="button"]')) return;
    if (composing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (canApply) applyCurrent();
  };

  return <section ref={panel} className={`${styles.root}${sidebar ? ` ${styles.sidebar}` : ""}`} aria-label={sidebar ? "常见节奏型" : "节奏型"} aria-busy={busy}
    tabIndex={sidebar ? undefined : -1} onKeyDown={handleEnter} data-rhythm-pattern-panel data-presentation={presentation}>
    <header className={styles.header}>
      {sidebar ? <h3>常见节奏型</h3> : <h2>节奏型</h2>}
      {!sidebar && <div className={styles.headerActions}>
        {hasTabs && onOpenSidebar && <button type="button" className={styles.handoff} disabled={busy || blocked}
          onClick={() => { if (openSidebar()) (props.onHandoff ?? props.onClose)(); }}>在侧栏展开</button>}
        <button type="button" className={styles.close} aria-label="关闭节奏型" disabled={busy} onClick={props.onClose}>×</button>
      </div>}
    </header>
    {hasTabs && <div className={styles.tabs} role="tablist" aria-label="节奏模板类别" data-rhythm-tabs>
      {templateTabs.map(({ id, label }) => <button key={id} id={tabId(id)} type="button" role="tab" data-rhythm-tab={id}
        aria-controls={paneId(id)} aria-selected={id === tab} tabIndex={id === tab ? 0 : -1}
        disabled={busy} onClick={() => selectTab(id)} onKeyDown={handleTabKey}>{label}</button>)}
    </div>}
    {!sidebar && !strum && <p className={styles.rules}><WarningOutlined aria-hidden="true" /> 应用后保留仍适用的技巧和连线，失效的标记会列在下方。</p>}
    {(hasTabs || templates.beats.length > 0 || templates.measures.length > 0) && <div id={hasTabs ? paneId("rhythm") : undefined}
      className={styles.templates} role={hasTabs ? "tabpanel" : "region"} aria-labelledby={hasTabs ? tabId("rhythm") : undefined}
      aria-label={hasTabs ? undefined : sidebar ? "节奏型模板" : "可滚动的节奏型模板"} hidden={strum} tabIndex={0}>
      {!strum && <>
        {templates.beats.length > 0 && <>
          <div className={styles.sectionHeading}>
            <strong>拍内模板</strong><span>{templates.signatures}</span>
          </div>
          <div className={styles.grid} id={`${templateGroupId}-beat`} role="group" aria-label="拍内模板" data-expanded={expanded.beat}>
            {templates.beats.map((template, index) => <TemplateCard key={template.id} template={template}
              extraAtTwoColumns={index >= firstExtra(2)} extraAtThreeColumns={index >= firstExtra(3)}
              selected={draft?.templateId === template.id} disabled={busy} onSelect={() => refresh(template.id)} />)}
          </div>
          {toggle("beat")}
        </>}
        {templates.measures.length > 0 && <>
          <div className={`${styles.sectionHeading} ${styles.measureHeading}`}>
            <strong>整小节模板</strong><span>{templates.measures.length} 条</span>
          </div>
          <div className={styles.measureList} id={`${templateGroupId}-measure`} role="group" aria-label="整小节模板" data-expanded={expanded.measure}>
            {templates.measures.map((template) => <TemplateCard key={template.id} template={template}
              selected={draft?.templateId === template.id} disabled={busy} onSelect={() => refresh(template.id)} />)}
          </div>
          {hasCollapsedMeasures && toggle("measure")}
        </>}
      </>}
    </div>}
    {hasTabs && <div id={paneId("strum")} className={styles.templates} role="tabpanel" aria-labelledby={tabId("strum")} hidden={!strum} tabIndex={0}>
      {strum && <>
        <p className={styles.strumLegend}>↓ 上扫 1→6弦　↑ 下扫 6→1弦　– 延音　每格 ¼ 拍</p>
        <div className={styles.strumGrid} id={`${templateGroupId}-strum`}>
          {templates.strums.map((template, index) => <StrumTemplateCard key={template.id} template={template}
            hidden={!expanded.strum && index >= collapsedStrumCount} disabled={busy}
            selected={(draft?.templateId ?? activeStrum?.id) === template.id} onSelect={() => refresh(template.id)} />)}
        </div>
        {templates.strums.length > collapsedStrumCount && toggle("strum")}
      </>}
    </div>}
    <footer className={styles.footer}>
      {discardedCount > 0 && <p className={styles.warning} role="status">{strum ? `应用将覆盖当前拍的 ${discardedCount} 个原有音组或休止。` : `应用将舍弃各拍末尾共 ${discardedCount} 个内容。`}{!!plan?.discardedTextCount && `其中含 ${plan.discardedTextCount} 项${plan.target.layer === "numbered" ? "歌词" : "和弦"}${strum ? "。" : "，应用前需确认。"}`}</p>}
      {strum && discardedCount === 0 && !!plan?.discardedTextCount && <p className={styles.warning} role="status">应用将移除 {plan.discardedTextCount} 项和弦标记。</p>}
      {!!plan?.removedMarks.length && <p className={styles.warning} role="status">应用将移除：{[...new Set(plan.removedMarks.map((mark) => mark.name))].join("、")}。{plan.removedMarks.some((mark) => mark.crossesScope) ? "包含跨出当前范围的连接。" : ""}{!strum && "点击应用一并确认。"}</p>}
      {message && <p className={stale || blocked ? styles.warning : styles.error} role={stale || blocked ? "status" : "alert"}>{message}</p>}
      <div className={styles.footerLine}>
        {destination && <p className={styles.destination} aria-live="polite">{destination}{draft?.templateName ? ` · ${draft.templateName}`
          : activeStrum ? ` · 已应用${activeStrum.name} · ${activeStrum.form}` : ""}</p>}
        <div className={styles.actions}>
          {undoStrum && <Button disabled={busy || blocked || stale} onClick={() => {
            if (undoStrum()) focusStrumResult();
          }}>撤销应用</Button>}
          {!sidebar && <Button disabled={busy} onClick={() => {
            if (strum && draft) cancelStrum();
            props.onClose();
          }}>{strum && !draft ? "关闭" : "取消"}</Button>}
          <Tooltip title={canApply && !strum ? "按 Enter 应用节奏型" : null} trigger={["hover", "focus"]}>
            <Button ref={applyButton} data-rhythm-apply type="primary" aria-label={strum ? "应用" : undefined}
              autoInsertSpace={false} loading={busy} disabled={!canApply}
              onClick={applyCurrent}>{strum ? "应用" : "应用节奏型"}</Button>
          </Tooltip>
        </div>
      </div>
    </footer>
  </section>;
}

const strumGlyphs = {
  up: { symbol: "↓", label: "上扫" },
  down: { symbol: "↑", label: "下扫" },
  hold: { symbol: "–", label: "延音" },
} as const;

function StrumTemplateCard({ template, selected, disabled, hidden, onSelect }: {
  template: BeatStrumRhythmPatternTemplate;
  selected: boolean;
  disabled: boolean;
  hidden: boolean;
  onSelect: () => void;
}) {
  const strokes = template.strokes.map(stroke => stroke ?? "hold");
  const label = `${template.name}，${template.form}，${strokes.map(stroke => strumGlyphs[stroke].label).join("、")}`;
  return <button type="button" className={`${styles.card} ${styles.strumCard}`} hidden={hidden}
    data-strum-template={template.id} aria-label={label} aria-pressed={selected} aria-disabled={disabled}
    onClick={() => { if (!disabled) onSelect(); }}>
    <span className={styles.templateName}>{template.form}</span>
    {selected && <span className={styles.check} aria-hidden="true">✓</span>}
    <span className={styles.strumStrokes} aria-hidden="true">
      {strokes.map((stroke, slot) => <span key={slot} data-strum-stroke={stroke}>{strumGlyphs[stroke].symbol}</span>)}
    </span>
  </button>;
}

function TemplateCard({ template, selected, disabled, onSelect, extraAtTwoColumns, extraAtThreeColumns }: {
  template: RhythmPatternTemplate | MeasureRhythmPatternTemplate;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  extraAtTwoColumns?: boolean;
  extraAtThreeColumns?: boolean;
}) {
  const measure = "beats" in template;
  const label = measure ? `${template.name}，${template.beats.map((beat) => beat.name).join("，")}` : template.name;
  return <button type="button" className={measure ? `${styles.card} ${styles.bar}` : styles.card} aria-label={label}
      aria-pressed={selected} disabled={disabled} onClick={onSelect}
      data-rhythm-template={measure ? undefined : template.id}
      data-rhythm-measure-template={measure ? template.id : undefined}
      data-extra={measure && template.collapsed ? "true" : undefined}
      data-extra-two={extraAtTwoColumns ? "true" : undefined}
      data-extra-three={extraAtThreeColumns ? "true" : undefined}>
      <span className={styles.templateName}>{template.name}</span>{selected && <span className={styles.check} aria-hidden="true">✓</span>}
      {measure ? <span className={styles.measureBeats}>
        {template.beats.map((beat, index) => <RhythmSymbol key={index} values={beat.values} />)}
      </span> : <RhythmSymbol values={template.values} />}
    </button>;
}

function RhythmSymbol({ values }: { values: readonly number[] }) {
  const xAt = (i: number) => values.length === 1 ? 67 : 19 + i * 111 / (values.length - 1);
  const levels = values.map((value) => value < 1 ? 3 : value < 2 ? 2 : value <= 3 ? 1 : 0);
  return <svg className={styles.rhythmSvg} viewBox="0 0 144 43" aria-hidden="true" focusable="false">
    <g className={styles.rhythmInk}>{values.map((value, i) => <g key={i}>
      <ellipse cx={xAt(i) - 3} cy="32" rx="5.1" ry="3.5" transform={`rotate(-18 ${xAt(i) - 3} 32)`} fill="currentColor" />
      <path d={`M${xAt(i) + 1} 31V6`} stroke="currentColor" strokeWidth="1.5" />
      {(value === 3 || value === 6) && <circle cx={xAt(i) + 9} cy="29" r="1.7" fill="currentColor" />}
      {[1, 2, 3].map((level) => {
        if (levels[i]! < level) return null;
        const y = 6 + (level - 1) * 6;
        if (i < values.length - 1 && levels[i + 1]! >= level) return <path key={level} d={`M${xAt(i) + 1} ${y}H${xAt(i + 1) + 1}`} stroke="currentColor" strokeWidth="3.5" />;
        if (i === 0 || levels[i - 1]! < level) return <path key={level} d={values.length === 1 ? `M${xAt(i) + 1} ${y}q11 5 6 15` : `M${xAt(i) + 1} ${y}h${i === values.length - 1 ? -10 : 10}`} stroke="currentColor" strokeWidth={values.length === 1 ? 2 : 3.5} fill="none" />;
        return null;
      })}
    </g>)}</g>
  </svg>;
}
