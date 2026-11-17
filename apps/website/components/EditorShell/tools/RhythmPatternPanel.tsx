"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import {
  calculateRhythmTicks,
  getRhythmPatternTemplates,
  inferRhythmPatternTemplate,
  LXMScoreCommandEnum,
  planRhythmPattern,
  type ILXMBeat,
  type ILXMDocument,
  type ILXMMeasure,
  type ILXMNumberedEvent,
  type ILXMRhythm,
  type RhythmPatternTarget,
} from "@liuxianmao/lxm-editor";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStoreState } from "../../../stores/editor-store";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { captureEditorVersion, sameEditorVersion } from "../session/editor-session-version";
import type { resolveEditorRhythmPatternTarget } from "./editor-rhythm-pattern-target";
import styles from "./RhythmPatternPanel.module.scss";

type TargetResult = ReturnType<typeof resolveEditorRhythmPatternTarget>;
type Plan = Extract<ReturnType<typeof planRhythmPattern>, { ok: true }>;
type Template = ReturnType<typeof getRhythmPatternTemplates>[number];
type PreviewEvent = ILXMBeat | ILXMNumberedEvent;
interface Props {
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
  onClose: () => void;
  onSuccess: (scope: RhythmPatternTarget) => void;
  onScopeChange?: (scope: RhythmPatternTarget | null) => void;
  onBusyChange: (busy: boolean) => void;
}

const targetMeasure = (document: ILXMDocument, result: TargetResult) => result.ok
  ? document.score.tracks.find((track) => track.id === result.target.trackId)?.measures.find((measure) => measure.id === result.target.measureId)
  : undefined;
const templatesFor = (document: ILXMDocument, result: TargetResult) => {
  const measure = targetMeasure(document, result);
  return getRhythmPatternTemplates(measure?.timeSignature ?? document.score.tracks[0]?.measures[0]?.timeSignature ?? { numerator: 4, denominator: 4 });
};
const previewFor = (props: Props, explicitTemplateId?: string) => {
  const state = props.session.getState();
  // Render 以本次 props 为准：实时 getter 的 ref 要到 layout effect 才更新，
  // 不能在同次 render 的选区刷新中读取它们。getter 仅用于提交瞬时保护。
  const targetResult = props.targetResult;
  const templates = state.document ? templatesFor(state.document, targetResult) : [];
  const selected = explicitTemplateId !== undefined
    ? templates.find((item) => item.id === explicitTemplateId)
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
    result: state.document && targetResult.ok && selected
      ? planRhythmPattern(state.document, targetResult.target, selected.id)
      : { ok: false as const, code: "INVALID_TARGET", message: !targetResult.ok ? targetResult.message
        : !templates.length ? "当前拍号暂无可用的节奏型。" : "当前拍未匹配到节奏型，请选择模板。" },
  };
};

/** 预览仅保存在面板内；文档、标记与撤销历史由同一条核心命令原子提交。 */
export function RhythmPatternPanel(props: Props) {
  const { session, document, targetResult, blocked, onScopeChange, onBusyChange } = props;
  const current = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [snapshot, setPreview] = useState(() => previewFor(props));
  const changed = snapshot.session !== session || !sameEditorVersion(current, snapshot.version) || snapshot.identity !== props.targetIdentity;
  // 在本次 render 即使用新快照，避免旧拍的手选和预览短暂显示在新选区上。
  const preview = changed ? previewFor(props) : snapshot;
  if (changed) setPreview(preview);
  const [failure, setFailure] = useState<string | null>(null);
  if (changed && failure !== null) setFailure(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const succeeded = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props);
  const applyButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { latest.current = props; });
  const stale = preview.session !== session || !sameEditorVersion(current, preview.version) || preview.identity !== props.targetIdentity;
  const plan = preview.result.ok ? preview.result : null;
  const templates = templatesFor(document, targetResult);
  const measure = preview.document ? targetMeasure(preview.document, preview.targetResult) : undefined;
  const scopeKey = plan && !stale ? JSON.stringify(plan.target) : null;
  useEffect(() => {
    onScopeChange?.(scopeKey ? JSON.parse(scopeKey) as RhythmPatternTarget : null);
  }, [scopeKey, onScopeChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!succeeded.current) latest.current.onScopeChange?.(null);
      latest.current.onBusyChange(false);
    };
  }, []);
  const isCurrent = () => {
    // 既检查会话版本，也检查 Shell 的简谱连续选区；后者不保存在 store 中。
    const now = latest.current;
    return mounted.current && now.session === preview.session && !now.blocked && !now.getBlocked() &&
      sameEditorVersion(now.session.getState(), preview.version) && now.getTargetIdentity() === preview.identity;
  };
  const refresh = (templateId: string) => {
    if (busyRef.current) return;
    setPreview(previewFor(latest.current, templateId));
    setFailure(null);
  };
  const apply = async () => {
    if (busyRef.current || !plan || !isCurrent()) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      latest.current.beforeAction();
      if (!isCurrent()) return;
      const result = await latest.current.execute({
        type: LXMScoreCommandEnum.ApplyRhythmPattern,
        // 版本与确认键仍绑定提交瞬时快照；一次应用授权移除受影响标记。
        target: preview.targetResult.ok ? preview.targetResult.target : plan.target,
        templateId: plan.template.id,
        expectedConfirmationKey: plan.confirmationKey,
        allowRemoveMarks: true,
      }, "caller", { isCurrent });
      if (!mounted.current) return;
      if (result.status === "applied" || result.status === "noop") {
        succeeded.current = true;
        // 先同步释放 busy 保护，再关闭浮层回焦；否则 Host 会把成功关闭当作忙碌中操作。
        busyRef.current = false;
        onBusyChange(false);
        latest.current.onSuccess(plan.target);
        return;
      }
      setFailure("message" in result ? result.message : result.result.message);
      requestAnimationFrame(() => applyButton.current?.focus({ preventScroll: true }));
    } catch {
      if (mounted.current) setFailure("应用失败，当前预览已保留，请重试。");
    } finally {
      busyRef.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  };
  const layerName = plan?.target.layer === "tab" || (!plan && targetResult.ok && targetResult.target.layer === "tab") ? "六线谱" : "简谱";
  const capturedTarget = preview.targetResult.ok ? preview.targetResult.target : null;
  const lyricCount = measure && plan?.target.layer === "numbered" ? measure.lyrics.filter((lyric) => plan.before.some((event) => event.id === lyric.eventId)).length : 0;
  const chordCount = measure && plan ? measure.chordSymbols.filter((chord) => {
    const beat = measure.beats.find((item) => item.id === chord.beatId);
    return beat && beat.tick >= plan.scope.startTick && beat.tick < plan.scope.endTick;
  }).length : 0;
  const retainedCount = plan?.perBeat.reduce((sum, beat) => sum + beat.retainedCount, 0) ?? 0;
  const gapCount = plan?.perBeat.reduce((sum, beat) => sum + beat.gapCount, 0) ?? 0;
  const message = failure ?? (!preview.result.ok ? preview.result.message : blocked ? "请先完成当前编辑，再应用节奏型；可继续浏览模板。" : null);

  return <section className={styles.root} aria-label="节奏型预览" aria-busy={busy} data-rhythm-pattern-panel>
    <header className={styles.header}>
      <h2>节奏型</h2>
      <button type="button" className={styles.close} aria-label="关闭节奏型" disabled={busy} onClick={props.onClose}>×</button>
    </header>
    <p className={styles.rules}><WarningOutlined aria-hidden="true" /> 按所选模板调整节奏，应用后会将相关技巧和连线移除。</p>
    <div className={styles.templates}>
      <div className={styles.grid} role="group" aria-label="节奏型模板">
        {templates.map((template, i) => <TemplateCard key={template.id} template={template} groupTitle={template.detail && !templates[i - 1]?.detail ? "三十二分细分" : null}
          selected={preview.templateId === template.id} disabled={busy} onSelect={() => refresh(template.id)} />)}
      </div>
    </div>
    <div className={styles.preview}>
      <div className={styles.sectionHeading}><strong>应用预览</strong><span>{plan?.template.name ?? (preview.templateId ? "范围待调整" : "请选择模板")}{plan ? ` · ${plan.scope.beatCount} 拍 · 逐拍套用` : ""}</span></div>
      <div className={styles.comparison}>
        <div className={styles.scoreBox}>
          <div className={styles.scoreLabel}>当前 <span>{plan ? `${plan.scope.beatCount} 个演奏拍` : "无有效范围"}</span></div>
          {plan && measure ? <ScorePreview plan={plan} events={plan.before} measure={measure} label="当前" /> : <div className={styles.empty}>{capturedTarget ? "选择模板后生成预览" : "请在谱面选择范围"}</div>}
        </div>
        <span className={styles.arrow} aria-hidden="true">→</span>
        <div className={`${styles.scoreBox} ${styles.after}`}>
          <div className={styles.scoreLabel}>应用后 <span>□ 待填空位 · 休止独立保留</span></div>
          {plan && measure ? <ScorePreview plan={plan} events={plan.after} measure={measure} label="应用后" /> : <div className={styles.empty}>调整范围或模板后生成预览</div>}
        </div>
      </div>
      {plan && <p className={styles.summary}>保留 {retainedCount} 个内容位置{gapCount ? `，模板含 ${gapCount} 个待填空位` : "，无待填空位"}。</p>}
      {(lyricCount > 0 || chordCount > 0) && <p className={styles.contentNote}>{lyricCount > 0 ? `${lyricCount} 处歌词随原内容保留。` : ""}{chordCount > 0 ? `${chordCount} 个和弦保留原拍点。` : ""}</p>}
      {message && <p className={stale || blocked ? styles.warning : styles.error} role={stale || blocked ? "status" : "alert"}>{message}</p>}
    </div>
    <footer className={styles.footer}>
      <span>{busy ? "正在应用…" : `${layerName} · ${plan ? `${plan.scope.beatCount} 拍` : "待选择"}`}</span>
      <div className={styles.actions}>
          <Button disabled={busy} onClick={props.onClose}>取消</Button>
          <Button ref={applyButton} type="primary" loading={busy} disabled={busy || blocked || stale || !plan} onClick={() => void apply()}>{failure ? "重试应用" : "应用节奏型"}</Button>
      </div>
    </footer>
  </section>;
}

function TemplateCard({ template, groupTitle, selected, disabled, onSelect }: {
  template: Template; groupTitle: string | null; selected: boolean; disabled: boolean; onSelect: () => void;
}) {
  return <>
    {groupTitle && <div className={styles.groupTitle}>{groupTitle}</div>}
    <button type="button" className={styles.card} aria-label={template.name} aria-pressed={selected} disabled={disabled} onClick={onSelect} data-rhythm-template={template.id}>
      <span className={styles.templateName}>{template.name}</span>{selected && <span className={styles.check} aria-hidden="true">✓</span>}
      <RhythmSymbol values={template.values} />
    </button>
  </>;
}

function RhythmSymbol({ values }: { values: readonly number[] }) {
  const xAt = (i: number) => values.length === 1 ? 67 : 19 + i * 111 / (values.length - 1);
  const levels = values.map((value) => value < 1 ? 3 : value < 2 ? 2 : value <= 3 ? 1 : 0);
  return <svg className={styles.rhythmSvg} viewBox="0 0 144 43" aria-hidden="true" focusable="false">
    {values.map((value, i) => <g key={i}>
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
    </g>)}
  </svg>;
}

const rhythmLabel = (rhythm: ILXMRhythm) => `${rhythm.dots ? "附点" : ""}${({ whole: "1", half: "1/2", quarter: "1/4", eighth: "1/8", sixteenth: "1/16", thirtySecond: "1/32" })[rhythm.base]}`;
const isGap = (event: PreviewEvent) => event.kind === "gap" || ("notes" in event && event.kind === "notes" && event.notes.length === 0);
const beamCount = (rhythm: ILXMRhythm) => rhythm.base === "thirtySecond" ? 3 : rhythm.base === "sixteenth" ? 2 : rhythm.base === "eighth" ? 1 : 0;

function ScorePreview({ plan, events, measure, label }: { plan: Plan; events: readonly PreviewEvent[]; measure: ILXMMeasure; label: string }) {
  const { startTick, endTick, beatTicks, beatCount } = plan.scope;
  const tab = plan.target.layer === "tab";
  const width = Math.max(294, beatCount * 210);
  const xAt = (tick: number) => 12 + (tick - startTick) / (endTick - startTick) * (width - 24);
  const eventX = (event: PreviewEvent) => {
    const duration = calculateRhythmTicks(event.rhythm);
    const ticks = label === "当前" ? plan.beforeDurationTicks[event.id] ?? (duration.ok ? duration.ticks : 0) : duration.ok ? duration.ticks : 0;
    return xAt(event.tick + Math.min(ticks / 2, beatTicks * .14));
  };
  const visible = events.filter((event) => event.tick >= startTick && event.tick < endTick);
  const describe = (event: PreviewEvent) => `${isGap(event) ? "待填空位" : event.kind === "rest" ? "明确休止" : "notes" in event ? event.notes.map((note) => `${note.string}弦${note.fret}品`).join("、") : event.items.map((item) => item.token).join("、")}，${rhythmLabel(event.rhythm)}`;
  return <div className={styles.scoreViewport} tabIndex={0} aria-label={`${label}谱面，可横向滚动`}>
    <svg className={styles.scoreSvg} style={{ minWidth: Math.max(270, beatCount * 210) }} viewBox={`0 0 ${width} 124`} role="img" aria-label={`${label}${tab ? "六线谱" : "简谱"}：${visible.map(describe).join("；") || "纯空白"}`}>
      {tab && [0, 1, 2, 3, 4, 5].map((line) => <path key={line} d={`M12 ${28 + line * 7}H${width - 12}`} stroke="currentColor" opacity=".3" strokeWidth=".7" />)}
      {Array.from({ length: Math.max(0, beatCount - 1) }, (_, i) => <path key={i} d={`M${xAt(startTick + (i + 1) * beatTicks)} 18V91`} stroke="currentColor" opacity=".2" strokeDasharray="3 3" />)}
      {visible.length === 0 && <text x={width / 2} y="55" textAnchor="middle" className={styles.svgHint}>空白范围 · 无发声内容</text>}
      {visible.map((event, i) => {
        const x = eventX(event), gap = isGap(event), beams = beamCount(event.rhythm);
        const next = visible[i + 1], previous = visible[i - 1];
        const sameBeat = (other: PreviewEvent | undefined) => !!other && Math.floor(other.tick / beatTicks) === Math.floor(event.tick / beatTicks) && !isGap(other) && other.kind === "notes";
        const lyrics = tab ? [] : measure.lyrics.filter((lyric) => lyric.eventId === event.id);
        return <g key={event.id} fill="currentColor">
          <title>{`${describe(event)}${lyrics.length ? `，歌词${lyrics.map((lyric) => lyric.text).join("、")}` : ""}`}</title>
          {gap ? <rect x={x - 8} y="39" width="16" height="19" rx="3" className={styles.gap} strokeDasharray="3 2" />
            : !tab && "items" in event ? <>
              {(event.kind === "rest" ? ["0"] : event.kind === "continuation" ? ["–"] : event.items.map((item) => item.token)).map((token, itemIndex, tokens) => <NumberedToken key={itemIndex} token={token} x={x} y={53 - itemIndex * (tokens.length > 3 ? 10 : 15)} small={tokens.length > 1} />)}
            </> : event.kind === "rest" ? <TabRest x={x} rhythm={event.rhythm} /> : "notes" in event ? event.notes.map((note) => <g key={note.id}>
              <rect x={x - 7} y={21 + (note.string - 1) * 7} width="14" height="14" className={styles.noteBackground} />
              <text x={x} y={32 + (note.string - 1) * 7} textAnchor="middle" fontSize="15">{note.fret}</text>
            </g>) : null}
          {!gap && !tab && <>
            {Array.from({ length: beams }, (_, level) => <path key={level} d={`M${x - 6} ${67 + level * 4}h12`} stroke="currentColor" strokeWidth="1.3" />)}
            {event.rhythm.dots > 0 && <circle cx={x + 10} cy="50" r="1.6" />}
            {event.rhythm.base === "half" && <text x={x + 18} y="53" fontSize="20">–</text>}
            {event.rhythm.base === "whole" && <text x={x + 15} y="53" fontSize="18">– – –</text>}
          </>}
          {!gap && tab && event.kind === "notes" && <>
            <path d={`M${x} 69V88`} stroke="currentColor" strokeWidth="1.2" />
            {Array.from({ length: beams }, (_, levelIndex) => {
              const level = levelIndex + 1, y = 88 - levelIndex * 6;
              if (sameBeat(next) && beamCount(next!.rhythm) >= level) return <path key={level} d={`M${x} ${y}H${eventX(next!)}`} stroke="currentColor" strokeWidth="2.5" />;
              return !(sameBeat(previous) && beamCount(previous!.rhythm) >= level) ? <path key={level} d={`M${x} ${y}q9 -2 6 -9`} stroke="currentColor" strokeWidth="1.8" fill="none" /> : null;
            })}
            {event.rhythm.dots > 0 && <circle cx={x + 9} cy="77" r="1.6" />}
          </>}
          <text x={x} y="105" textAnchor="middle" className={styles.svgHint}>{rhythmLabel(event.rhythm)}</text>
          {lyrics.length > 0 && <text x={x} y="120" textAnchor="middle" className={styles.svgLyric}>{lyrics.map((lyric) => lyric.text).join(" / ")}</text>}
        </g>;
      })}
      {(label === "应用后" ? plan.track.measures.find((item) => item.id === measure.id) ?? measure : measure).chordSymbols.map((chord) => {
        const chordMeasure = label === "应用后" ? plan.track.measures.find((item) => item.id === measure.id) ?? measure : measure;
        const beat = chordMeasure.beats.find((item) => item.id === chord.beatId);
        return beat && beat.tick >= startTick && beat.tick < endTick ? <text key={chord.id} x={xAt(beat.tick) + 8} y="13" className={styles.svgLyric}>{chord.chord.name}</text> : null;
      })}
    </svg>
  </div>;
}

function NumberedToken({ token, x, y, small }: { token: string; x: number; y: number; small: boolean }) {
  const digits = token.replace(/['.]/g, "").replace("#", "♯").replace("b", "♭").replace("n", "♮");
  const high = (token.match(/'/g) ?? []).length, low = (token.match(/\./g) ?? []).length;
  return <g><text x={x} y={y} textAnchor="middle" fontSize={small ? 16 : 23}>{digits}</text>
    {Array.from({ length: high }, (_, i) => <circle key={`h${i}`} cx={x} cy={y - (small ? 18 : 25) - i * 4} r="1.3" />)}
    {Array.from({ length: low }, (_, i) => <circle key={`l${i}`} cx={x} cy={y + 5 + i * 4} r="1.3" />)}
  </g>;
}

function TabRest({ x, rhythm }: { x: number; rhythm: ILXMRhythm }) {
  const beams = beamCount(rhythm);
  return <g>
    {beams ? <><path d={`M${x + 4} 35l-6 24`} stroke="currentColor" strokeWidth="1.5" fill="none" />{Array.from({ length: beams }, (_, i) => <circle key={i} cx={x - i * 2} cy={39 + i * 7} r="2.6" />)}</>
      : rhythm.base === "quarter" ? <path d={`m${x + 2} 33-5 7 7 6-6 5 3 6-7-4 4-7-5-5Z`} />
      : <rect x={x - 5} y={rhythm.base === "whole" ? 42 : 45} width="10" height="4" />}
    {rhythm.dots > 0 && <circle cx={x + 10} cy="46" r="1.6" />}
  </g>;
}
