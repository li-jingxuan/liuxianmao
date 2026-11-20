"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEventHandler, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, Tooltip } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import {
  getMeasureRhythmPatternTemplates,
  getRhythmPatternTemplates,
  inferRhythmPatternTemplate,
  LXMScoreCommandEnum,
  planRhythmPattern,
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
  onBusyChange: (busy: boolean) => void;
}
interface Props extends RhythmPatternConfig {
  onClose: () => void;
  presentation?: "toolbar" | "sidebar";
}

const targetMeasure = (document: ILXMDocument, result: TargetResult) => result.ok
  ? document.score.tracks.find((track) => track.id === result.target.trackId)?.measures.find((measure) => measure.id === result.target.measureId)
  : undefined;
const templatesFor = (document: ILXMDocument, result: TargetResult) => {
  const measure = targetMeasure(document, result);
  const signature = measure?.timeSignature ?? document.score.tracks[0]?.measures[0]?.timeSignature ?? { numerator: 4, denominator: 4 };
  return {
    signature,
    beats: getRhythmPatternTemplates(signature),
    measures: getMeasureRhythmPatternTemplates(signature),
  };
};
const previewFor = (props: RhythmPatternConfig, explicitTemplateId?: string) => {
  const state = props.session.getState();
  // Render 以本次 props 为准：实时 getter 的 ref 要到 layout effect 才更新，
  // 不能在同次 render 的选区刷新中读取它们。getter 仅用于提交瞬时保护。
  const targetResult = props.targetResult;
  const templates = state.document ? templatesFor(state.document, targetResult) : undefined;
  const selected = explicitTemplateId !== undefined
    ? templates?.beats.find((item) => item.id === explicitTemplateId) ?? templates?.measures.find((item) => item.id === explicitTemplateId)
    : state.document && targetResult.ok ? inferRhythmPatternTemplate(state.document, targetResult.target) : null;
  return {
    session: props.session,
    version: captureEditorVersion(state),
    identity: props.targetIdentity,
    document: state.document,
    targetResult,
    // 手选只属于本次目标与文档快照，目标或文档变化后重新识别。
    explicitTemplateId,
    templateId: selected?.id,
    templateName: selected?.name,
    result: state.document && targetResult.ok && selected
      ? planRhythmPattern(state.document, targetResult.target, selected.id)
      : { ok: false as const, code: "INVALID_TARGET", message: !targetResult.ok ? targetResult.message
        : !templates?.beats.length ? "当前拍号暂无可用的节奏型。" : "当前拍未匹配到节奏型，请选择模板。" },
  };
};

/** 一个 Provider 对应一个编辑会话；两处入口共享快照和同步提交锁。 */
function useRhythmPatternController(props: RhythmPatternConfig, enabled = true) {
  const { session, document, targetResult, onScopeChange, onBusyChange } = props;
  const current = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [localSnapshot, setPreview] = useState(() => enabled ? previewFor(props) : null);
  const snapshot = localSnapshot ?? previewFor(props);
  const changed = snapshot.session !== session || !sameEditorVersion(current, snapshot.version) || snapshot.identity !== props.targetIdentity;
  // 在本次 render 即使用新快照，避免旧拍的手选和预览短暂显示在新选区上。
  const preview = changed ? previewFor(props) : snapshot;
  if (enabled && changed) setPreview(preview);
  const [failure, setFailure] = useState<string | null>(null);
  if (enabled && changed && failure !== null) setFailure(null);
  const [busy, setBusy] = useState(false);
  const [expansion, setExpansion] = useState({
    toolbar: { beat: false, measure: false },
    sidebar: { beat: false, measure: false },
  });
  const busyRef = useRef(false);
  const generation = useRef(0);
  const previewGeneration = generation.current;
  const succeeded = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props);
  const applyButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { latest.current = props; });
  const stale = preview.session !== session || !sameEditorVersion(current, preview.version) || preview.identity !== props.targetIdentity;
  const plan = preview.result.ok ? preview.result : null;
  const templates = templatesFor(document, targetResult);
  const measure = preview.document ? targetMeasure(preview.document, preview.targetResult) : undefined;
  const measureNumber = measure ? preview.document?.score.tracks
    .find((track) => track.measures.includes(measure))?.measures.indexOf(measure) : undefined;
  const scopeKey = plan && !stale ? JSON.stringify(plan.target) : null;
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
  const isPreviewCurrent = () => {
    // 既检查会话版本，也检查 Shell 的简谱连续选区；后者不保存在 store 中。
    const now = latest.current;
    return mounted.current && generation.current === previewGeneration && now.session === preview.session &&
      sameEditorVersion(now.session.getState(), preview.version) && now.getTargetIdentity() === preview.identity;
  };
  const isCurrent = () => isPreviewCurrent() && !latest.current.blocked && !latest.current.getBlocked();
  const refresh = (templateId: string) => {
    if (busyRef.current) return;
    generation.current += 1;
    setPreview(previewFor(latest.current, templateId));
    setFailure(null);
  };
  const apply = async (onApplied?: (scope: RhythmPatternTarget) => void) => {
    if (busyRef.current || !plan || !isCurrent()) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const confirmDiscard = plan.discardedTextCount > 0;
      if (!confirmDiscard) latest.current.beforeAction();
      if (!isCurrent()) return;
      const result = await latest.current.execute({
        type: LXMScoreCommandEnum.ApplyRhythmPattern,
        // 版本与确认键绑定提交瞬时快照；只授权移除本次预览列出的标记。
        target: preview.targetResult.ok ? preview.targetResult.target : plan.target,
        templateId: plan.template.id,
        expectedConfirmationKey: plan.confirmationKey,
        allowRemoveMarks: plan.removedMarks.length > 0,
      }, confirmDiscard ? "modal" : "caller", { isCurrent: confirmDiscard ? isPreviewCurrent : isCurrent });
      if (!mounted.current) return;
      if (result.status === "applied" || result.status === "noop") {
        succeeded.current = true;
        generation.current += 1;
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
      requestAnimationFrame(() => applyButton.current?.focus({ preventScroll: true }));
    } catch {
      if (mounted.current) setFailure("应用失败，请重试。");
    } finally {
      busyRef.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  };
  return { preview, plan, templates, measureNumber, stale, failure, busy, refresh, apply, applyButton, expansion, setExpansion };
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
export function SidebarRhythmPatternPanel() {
  const shared = useContext(RhythmPatternContext);
  return shared ? <RhythmPatternPanel {...shared.config} presentation="sidebar" onClose={() => {}} /> : null;
}

/** 不提供 Provider 的既有调用仍保持独立面板兼容。 */
export function RhythmPatternPanel(props: Props) {
  const shared = useContext(RhythmPatternContext);
  const local = useRhythmPatternController(shared?.config ?? props, !shared);
  const { preview, plan, templates, measureNumber, stale, failure, busy, refresh, apply, applyButton, expansion, setExpansion } = shared?.controller ?? local;
  const { blocked, targetResult } = shared?.config ?? props;
  const presentation = props.presentation ?? "toolbar";
  const sidebar = presentation === "sidebar";
  const expanded = expansion[presentation];
  const templateGroupId = useId();
  const firstExtra = (columns: number) => Math.max(0, Math.ceil(templates.beats.length / columns) - 2) * columns;
  const hasCollapsedMeasures = templates.measures.some((template) => template.collapsed);
  const toggle = (group: "beat" | "measure") => {
    const title = group === "beat" ? "拍内模板" : "整小节模板";
    return <button type="button" className={styles.toggle} disabled={busy}
      aria-expanded={expanded[group]} aria-controls={`${templateGroupId}-${group}`} data-rhythm-toggle={group}
      onClick={(event) => {
        const button = event.currentTarget;
        const firstExtra = group === "measure" && !expanded.measure
          ? button.previousElementSibling?.querySelector<HTMLElement>("[data-extra]")
          : undefined;
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
      {expanded[group] ? `收起${title}` : `展开${title}`} <span aria-hidden="true">{expanded[group] ? "▴" : "▾"}</span>
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
  const message = failure ?? (!preview.result.ok ? preview.result.message : blocked ? "请先完成当前编辑，再应用节奏型；可继续浏览模板。" : null);
  const discardedCount = plan?.perBeat.reduce((total, beat) => total + beat.discardedCount, 0) ?? 0;
  const destination = plan && ("beats" in plan.template ? "整小节" : plan.scope.beatCount === 1
    ? `第 ${plan.scope.firstBeat} 拍` : `第 ${plan.scope.firstBeat}–${plan.scope.lastBeat} 拍`);
  const canApply = !busy && !blocked && !stale && !!plan;
  const applyCurrent = () => void apply(shared && !sidebar ? props.onSuccess : undefined);
  const handleEnter: KeyboardEventHandler<HTMLElement> = (event) => {
    if (event.key !== "Enter" || event.defaultPrevented || !(event.target instanceof Element) ||
      !event.currentTarget.contains(event.target)) return;
    const target = event.target;
    const card = target.closest("[data-rhythm-template], [data-rhythm-measure-template]");
    const applyControl = target.closest("[data-rhythm-apply]");
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if ((card || applyControl) && (event.repeat || composing)) {
      event.preventDefault();
      return;
    }
    // 未选卡片和应用按钮仍走原生 click，其他交互控件保留自己的键盘行为。
    if (card ? card.getAttribute("aria-pressed") !== "true" :
      target.closest('button, a[href], input, select, textarea, [contenteditable], [role="button"]')) return;
    if (composing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (canApply) applyCurrent();
  };

  return <section className={`${styles.root}${sidebar ? ` ${styles.sidebar}` : ""}`} aria-label={sidebar ? "常见节奏型" : "节奏型"} aria-busy={busy}
    tabIndex={sidebar ? undefined : -1} onKeyDown={handleEnter} data-rhythm-pattern-panel data-presentation={presentation}>
    <header className={styles.header}>
      {sidebar ? <h3>常见节奏型</h3> : <h2>节奏型</h2>}
      {!sidebar && <button type="button" className={styles.close} aria-label="关闭节奏型" disabled={busy} onClick={props.onClose}>×</button>}
    </header>
    {!sidebar && <p className={styles.rules}><WarningOutlined aria-hidden="true" /> 应用后保留仍适用的技巧和连线，失效的标记会列在下方。</p>}
    {templates.beats.length > 0 && <div className={styles.templates} role="region" aria-label={sidebar ? "节奏型模板" : "可滚动的节奏型模板"} tabIndex={0}>
      <div className={styles.sectionHeading}>
        <strong>拍内模板</strong><span>{templates.signature.numerator}/{templates.signature.denominator}</span>
      </div>
      <div className={styles.grid} id={`${templateGroupId}-beat`} role="group" aria-label="拍内模板" data-expanded={expanded.beat}>
        {templates.beats.map((template, index) => <TemplateCard key={template.id} template={template}
          extraAtTwoColumns={index >= firstExtra(2)} extraAtThreeColumns={index >= firstExtra(3)}
          selected={preview.templateId === template.id} disabled={busy} onSelect={() => refresh(template.id)} />)}
      </div>
      {toggle("beat")}
      {templates.measures.length > 0 && <>
        <div className={`${styles.sectionHeading} ${styles.measureHeading}`}>
          <strong>整小节模板</strong><span>{templates.measures.length} 条</span>
        </div>
        <div className={styles.measureList} id={`${templateGroupId}-measure`} role="group" aria-label="整小节模板" data-expanded={expanded.measure}>
          {templates.measures.map((template) => <TemplateCard key={template.id} template={template}
            selected={preview.templateId === template.id} disabled={busy} onSelect={() => refresh(template.id)} />)}
        </div>
        {hasCollapsedMeasures && toggle("measure")}
      </>}
    </div>}
    <footer className={styles.footer}>
      {discardedCount > 0 && <p className={styles.warning} role="status">应用将舍弃各拍末尾共 {discardedCount} 个内容。{!!plan?.discardedTextCount && `其中含 ${plan.discardedTextCount} 项${plan.target.layer === "numbered" ? "歌词" : "和弦"}，应用前需确认。`}</p>}
      {!!plan?.removedMarks.length && <p className={styles.warning} role="status">应用将移除：{[...new Set(plan.removedMarks.map((mark) => mark.name))].join("、")}。{plan.removedMarks.some((mark) => mark.crossesScope) ? "包含跨出当前范围的连接。" : ""}点击应用一并确认。</p>}
      {message && <p className={stale || blocked ? styles.warning : styles.error} role={stale || blocked ? "status" : "alert"}>{message}</p>}
      <div className={styles.footerLine}>
        {destination && measureNumber !== undefined && <p className={styles.destination} aria-live="polite">第 {measureNumber + 1} 小节 · {destination} · {preview.templateName}</p>}
        <div className={styles.actions}>
          {!sidebar && <Button disabled={busy} onClick={props.onClose}>取消</Button>}
          <Tooltip title={canApply ? "按 Enter 应用节奏型" : null} trigger={["hover", "focus"]}>
            <Button ref={applyButton} data-rhythm-apply type="primary" loading={busy} disabled={!canApply} onClick={applyCurrent}>应用节奏型</Button>
          </Tooltip>
        </div>
      </div>
    </footer>
  </section>;
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
