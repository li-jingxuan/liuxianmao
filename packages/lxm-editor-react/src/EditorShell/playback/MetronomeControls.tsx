"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { ChevronDown, Play, Square, Timer } from "lucide-react";
import { DEFAULT_PLAYBACK_BPM, MAX_PLAYBACK_BPM, MIN_PLAYBACK_BPM, type ILXMDocument, type ILXMTimeSignature } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import { isMetronomeBpm, meterLabel, practiceMeters } from "./metronome-grid";
import { PracticeMetronome, readPracticeSource } from "./practice-metronome";
import toolbar from "../workspace/EditorToolbar.module.scss";
import styles from "./MetronomeControls.module.scss";

// 浮层不锁住工作区。外点时交还浏览器处理点击与焦点，只有显式收起或 Esc 才把焦点还给入口。
function useMetronomePopover(anchor: RefObject<HTMLDivElement | null>, trigger: RefObject<HTMLButtonElement | null>, onDismiss?: () => void) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = (restoreFocus: boolean) => {
    onDismiss?.();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (open) anchor.current?.querySelector<HTMLElement>("[data-metronome-initial]")?.focus({ preventScroll: true });
  }, [anchor, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target)) return;
      onDismiss?.();
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchor, open, onDismiss]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open || event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  return { open, panelId, setOpen, close, onKeyDown };
}

function BeatCells({ meter, beat, accent }: { meter: ILXMTimeSignature; beat: number | null; accent: boolean }) {
  const { numerator, denominator } = meter;
  // 常用及不对称拍号逐格显示。极大的导入分子只绘制当前格附近的窗口，读数仍显示完整拍序。
  const visibleCount = Math.min(numerator, 8);
  const first = Math.max(1, Math.min((beat ?? 1) - 3, numerator - visibleCount + 1));
  return (
    <div className={styles.beats} data-metronome-beats aria-label="拍点">
      <div className={styles.cells} aria-hidden="true">
        {Array.from({ length: visibleCount }, (_, index) => first + index).map((number) => (
          <span key={number} className={styles.cell} data-current={number === beat} title={`第 ${number} 拍`}
            data-accent={number === 1 && accent} data-group-break={numerator === 6 && denominator === 8 && number === 4}>
            {number}
          </span>
        ))}
      </div>
      <p className={styles.readout} aria-live="off">{beat === null ? "等待开始" : `当前拍点 ${beat} / ${numerator}`}{accent ? " · ◆ 首拍重音" : ""}</p>
    </div>
  );
}

export function PracticeMetronomeControls({ practice, document, accent, onAccent }: {
  practice: PracticeMetronome;
  document: ILXMDocument;
  accent: boolean;
  onAccent(accent: boolean): void;
}) {
  const state = useSyncExternalStore(practice.subscribe, practice.snapshot, practice.snapshot);
  const source = readPracticeSource(document);
  const { bpm, meter } = state.settings ?? source;
  const active = state.phase !== "stopped";
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const bpmRef = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bpmId = useId();
  const parseDraft = () => {
    const text = draft ?? String(bpm);
    const value = Number(text);
    return /^\d+$/.test(text) && isMetronomeBpm(value) ? value : null;
  };
  const validate = () => {
    const value = parseDraft();
    setInvalid(value === null);
    if (value === null) return false;
    if (value !== bpm) practice.setSettings({ bpm: value, meter });
    setDraft(null);
    return true;
  };
  const popover = useMetronomePopover(anchor, trigger, () => {
    // 外点的 pointerdown 先于原生失焦。显式提交当前有效值，关闭时舍弃无效草稿。
    const value = parseDraft();
    if (!active && value !== null && value !== bpm) practice.setSettings({ bpm: value, meter });
    setDraft(null);
    setInvalid(false);
  });
  const setOpen = popover.setOpen;
  useEffect(() => {
    const leave = () => { setOpen(false); setDraft(null); setInvalid(false); };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [setOpen]);
  const status = state.phase === "starting" ? "正在启动" : state.phase === "running"
    ? state.mute ? "运行中 · 已静音" : "运行中" : "已停止";
  const restore = () => {
    practice.setSettings({ bpm: source.bpm, meter: source.meter });
    setDraft(null);
    setInvalid(false);
  };
  const toggle = () => {
    if (popover.open) popover.close(false);
    else {
      practice.initialize(source);
      popover.setOpen(true);
    }
  };
  const startOrStop = () => {
    if (active) practice.stop();
    else if (validate()) {
      practice.setAccent(accent);
      void practice.start();
    } else bpmRef.current?.focus();
  };

  return (
    <div className={styles.practice} data-practice-metronome ref={anchor} onKeyDown={popover.onKeyDown}>
      <button type="button" className={`${toolbar.panelToggle} ${toolbar.playbackToggle}`}
        ref={trigger} aria-haspopup="dialog" aria-expanded={popover.open} aria-controls={popover.panelId} onClick={toggle}>
        <Timer size={17} strokeWidth={1.7} aria-hidden="true" />节拍器
        {active && <span className={styles.running}>{status}</span>}
        {!active && state.message && !popover.open && <span className={styles.warning}>声音不可用</span>}
      </button>
      {active && <button type="button" className={toolbar.playbackButton} aria-label="快捷停止节拍器" onClick={() => {
        practice.stop();
        (popover.open ? action.current : trigger.current)?.focus({ preventScroll: true });
      }}><Square size={13} aria-hidden="true" />停止</button>}
      <span role="status" className={styles.assistive}>{status}{!popover.open && state.message ? `。${state.message}` : ""}</span>
      {popover.open && <section className={styles.panel} id={popover.panelId} role="dialog" aria-labelledby={`${popover.panelId}-title`}>
        <div className={styles.heading}>
          <div><h2 id={`${popover.panelId}-title`}>节拍器</h2><span className={styles.detail}>{status}</span></div>
          <button type="button" className={toolbar.playbackButton} aria-label="收起节拍器" onClick={() => popover.close(true)}>收起</button>
        </div>
        <p className={styles.source}><strong>{source.sourceLabel}</strong> {source.bpm} BPM / {meterLabel(source.meter)}<br />
          <span>{source.detail}</span></p>
        <div className={styles.fields}>
          <div>
            <label htmlFor={bpmId}>练习速度（BPM）</label>
            <input id={bpmId} ref={bpmRef} className={toolbar.playbackField} type="number"
              min={MIN_PLAYBACK_BPM} max={MAX_PLAYBACK_BPM} step={1} required disabled={active}
              aria-label="节拍器练习速度（BPM）" aria-invalid={invalid || undefined}
              aria-describedby={`${bpmId}-unit${invalid ? ` ${bpmId}-error` : ""}`} data-metronome-initial={active ? undefined : ""}
              value={draft ?? bpm} onChange={(event) => {
                const { value, valueAsNumber } = event.currentTarget;
                setDraft(value);
                if (/^\d+$/.test(value) && isMetronomeBpm(valueAsNumber)) setInvalid(false);
              }} onBlur={() => { if (!active) validate(); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault();
                  validate();
                }
              }} />
            <span id={`${bpmId}-unit`} className={styles.detail}>每分钟四分音符数</span>
            {/* 预留校验行，避免失焦校验在鼠标按下与抬起之间移动后续按钮或复选框。 */}
            <span id={`${bpmId}-error`} className={styles.warning} role="status">{invalid ? "输入 20–300 的整数。" : "\u00a0"}</span>
          </div>
          <div>
            <label htmlFor={`${bpmId}-meter`}>练习拍号</label>
            <select id={`${bpmId}-meter`} className={toolbar.playbackField} disabled={active} aria-label="节拍器练习拍号"
              value={meterLabel(meter)} onChange={(event) => {
                const selected = practiceMeters.find((item) => meterLabel(item) === event.currentTarget.value);
                // 点击拍号时 BPM 可能刚刚失焦并提交，用最新有效值避免被本轮渲染的旧值覆盖。
                if (selected) practice.setSettings({ bpm: practice.snapshot().settings?.bpm ?? bpm, meter: selected });
              }}>
              {practiceMeters.map((item) => <option key={meterLabel(item)}>{meterLabel(item)}</option>)}
            </select>
            <span className={styles.detail}>每小节 {meter.numerator} 个{meter.denominator === 8 ? "八分" : "四分"}音符</span>
          </div>
        </div>
        <div className={styles.beatArea}>
          <h3>拍点</h3><BeatCells meter={meter} beat={state.beat} accent={accent} />
        </div>
        <div className={styles.options}>
          <label className={styles.check}><input type="checkbox" checked={accent} onChange={(event) => {
            practice.setAccent(event.currentTarget.checked);
            onAccent(event.currentTarget.checked);
          }} />首拍重音</label>
          <label className={styles.check}><input type="checkbox" aria-label="静音节拍器" checked={state.mute} disabled={state.phase === "starting"}
            onChange={(event) => void practice.setMute(event.currentTarget.checked)} />静音</label>
        </div>
        <div className={styles.options}>
          <button ref={action} type="button" className={`${toolbar.playbackButton} ${toolbar.playbackPrimary}`}
            data-metronome-initial={active ? "" : undefined} onClick={startOrStop}>
            {active ? <Square size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {active ? "停止节拍器" : "开始节拍器"}
          </button>
          <button type="button" className={toolbar.playbackButton} disabled={active} onClick={restore}>恢复曲谱设置</button>
        </div>
        <p className={styles.detail}>{active ? "收起后继续运行。停止后可调整速度与拍号。" : "收起面板后，节拍器会继续运行。"}</p>
        {state.message && <p role="status" className={styles.message}>{state.message}</p>}
      </section>}
    </div>
  );
}

export function AuditionMetronomeControls({ playback, onRestore }: { playback: ScorePlaybackControls; onRestore(): void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useMetronomePopover(anchor, trigger);
  const meter = playback.currentMeter ?? playback.startingMeter;
  const source = playback.savedBpm ?? DEFAULT_PLAYBACK_BPM;
  const status = playback.phase === "paused" ? "已暂停"
    : playback.phase === "playing" ? "跟随播放" : "待播放";

  return (
    <div className={styles.audition} role="group" aria-label="试听节拍器" data-click-disabled={!playback.clickEnabled || undefined}>
      <div className={styles.auditionStatus}><strong>节拍器</strong>{playback.clickEnabled && <span role="status">{status}</span>}</div>
      <BeatCells meter={meter} beat={playback.clickBeat} accent={playback.clickAccent} />
      {/* 关闭只会停止随谱点击并清掉拍点。设置随组件灰显，复选框继续可操作，以便播放中恢复。 */}
      <label className={styles.check}><input type="checkbox" checked={playback.clickEnabled}
        onChange={(event) => {
          const enabled = event.currentTarget.checked;
          if (!enabled && popover.open) popover.close(false);
          playback.setClickEnabled(enabled);
        }} />启用节拍器</label>
      <div className={styles.settingsAnchor} ref={anchor} onKeyDown={popover.onKeyDown}>
        <button type="button" className={toolbar.playbackButton} aria-label="节拍器设置" aria-haspopup="dialog"
          aria-expanded={popover.open} aria-controls={popover.panelId} ref={trigger} disabled={!playback.clickEnabled}
          onClick={() => { if (popover.open) popover.close(false); else popover.setOpen(true); }}>
          设置<ChevronDown size={12} aria-hidden="true" />
        </button>
        {popover.open && <section className={`${styles.panel} ${styles.settings}`} id={popover.panelId} role="dialog" aria-labelledby={`${popover.panelId}-title`}>
          <div className={styles.heading}>
            <h2 id={`${popover.panelId}-title`}>节拍器设置</h2>
            <button type="button" className={toolbar.playbackButton} aria-label="收起节拍器设置" onClick={() => popover.close(true)}>收起</button>
          </div>
          <div className={styles.fields}>
            <div><label htmlFor={`${popover.panelId}-bpm`}>试听速度（BPM）</label>
              <output id={`${popover.panelId}-bpm`} aria-live="off">{playback.bpm}</output></div>
            <div><label htmlFor={`${popover.panelId}-meter`}>当前小节拍号</label>
              <output id={`${popover.panelId}-meter`} aria-live="off">{meterLabel(meter)}</output></div>
          </div>
          <p className={styles.source}><strong>曲谱设置</strong> {source} BPM / {meterLabel(meter)}<br />
            <span>{playback.savedBpm === null ? `曲谱速度未设置，试听按 ${source} BPM。` : "节拍跟随谱面试听。"}</span></p>
          <div className={`${styles.options} ${styles.settingsFooter}`}>
            <label className={styles.check}><input type="checkbox" data-metronome-initial="" checked={playback.clickAccent}
              onChange={(event) => playback.setClickAccent(event.currentTarget.checked)} />首拍重音</label>
            <button type="button" className={toolbar.playbackButton} aria-label="恢复曲谱试听速度" disabled={playback.bpm === source}
              onClick={onRestore}>恢复</button>
          </div>
        </section>}
      </div>
      {playback.clickFailed && <p role="status" className={styles.auditionMessage}>节拍提示音不可用，拍点继续跟随谱面。</p>}
    </div>
  );
}
