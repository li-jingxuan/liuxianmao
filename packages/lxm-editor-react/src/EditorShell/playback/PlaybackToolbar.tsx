"use client";

import { useEffect, useRef, useState } from "react";
import { Select } from "antd";
import { Pause, Play, Square } from "lucide-react";
import { DEFAULT_PLAYBACK_BPM, MAX_PLAYBACK_BPM, MIN_PLAYBACK_BPM } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import { AuditionMetronomeControls } from "./MetronomeControls";
import { useEditorIdPrefix } from "../session/EditorSessionRuntime";
import styles from "../workspace/EditorToolbar.module.scss";

export const PlaybackToolbar = ({ playback }: {
  playback: ScorePlaybackControls;
}) => {
  const { phase, position } = playback;
  const idPrefix = useEditorIdPrefix();
  const tempoId = `${idPrefix}editor-playback-bpm`;
  const tempoNoteId = `${idPrefix}editor-playback-tempo-note`;
  const descriptionId = `${idPrefix}editor-playback-description`;
  // 配对和缺房都已抵达有效路线末端，允许切换起点或从头重新试听。
  const blocked = Boolean(playback.jumpIssue || playback.repeatEndingIssue);
  const active = phase === "loading" || phase === "playing" || (phase === "paused" && !blocked);
  const playLabel = blocked ? "重新播放" : { idle: "播放", loading: "加载中…", playing: "暂停", paused: "继续", error: "重试" }[phase];
  const [tempoDraft, setTempoDraft] = useState<string | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 等编辑工具完成卸载再交接焦点，避免残留的浮层在 React 提交期间处理焦点离开。
    const frame = requestAnimationFrame(() => playButton.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const scoreBpm = playback.savedBpm ?? DEFAULT_PLAYBACK_BPM;
  const adjusted = playback.bpm !== scoreBpm;
  const restoreTempo = () => { setTempoDraft(null); playback.resetBpm(); };
  // 常用速度使用较细的滑杆范围。已应用或手动输入的极值也必须能在滑杆上正确显示和恢复。
  const sliderMin = Math.min(40, scoreBpm, playback.bpm);
  const sliderMax = Math.max(180, scoreBpm, playback.bpm);
  const playbackStatus = playback.jumpEnd ? "试听结束" : phase === "playing" ? "正在试听" : phase === "paused" ? "试听已暂停"
    : phase === "loading" ? "正在准备试听" : adjusted ? "临时调速试听" : "按曲谱速度试听";
  const startValue = playback.startOptions.find(({ measureId }) => measureId === playback.startMeasureId)?.value ?? 0;

  return (
    <div
      id={`${idPrefix}editor-playback-controls`}
      data-editor-playback-controls
      className={styles.playbackControls}
      role="group"
      aria-label="木吉他试听工具"
      aria-describedby={descriptionId}
    >
      <span id={descriptionId} className={styles.hint}>试听以已提交的六线谱为准。</span>
      <div className={styles.playbackGroup}>
        <button ref={playButton} type="button" className={`${styles.playbackButton} ${styles.playbackPrimary}`} aria-disabled={phase === "loading" || undefined}
          onClick={() => { if (phase !== "loading") playback.togglePlay(); }}>
          {phase === "playing" ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {playLabel}
        </button>
        <button type="button" className={styles.playbackButton} disabled={!active && !position && phase !== "error"} onClick={playback.stop}>
          <Square size={14} aria-hidden="true" />停止
        </button>
        {/* 下拉和谱面单选共用起点。播放期间锁定已选值，暂停后可继续原位置。 */}
        <Select<number> className={styles.playbackStart} aria-label="播放起点" disabled={active}
          value={startValue} options={playback.startOptions}
          onChange={(value) => playback.setStartMeasure(playback.startOptions[value]?.measureId ?? null)} />
      </div>
      <div className={`${styles.playbackGroup} ${styles.playbackTempoGroup}`}>
        <label htmlFor={tempoId}>临时调速</label>
        <input className={styles.playbackSlider} type="range" aria-label="临时调速" aria-describedby={tempoNoteId} min={sliderMin} max={sliderMax}
          step={1} value={playback.bpm} onChange={(event) => { setTempoDraft(null); playback.setBpm(event.currentTarget.valueAsNumber); }} />
        <input id={tempoId} className={`${styles.playbackField} ${styles.playbackTempo}`} type="number" min={MIN_PLAYBACK_BPM} max={MAX_PLAYBACK_BPM} step={1}
          aria-label="速度，每分钟四分音符数" aria-describedby={tempoNoteId} value={tempoDraft ?? playback.bpm}
          onChange={(event) => {
            const { value, valueAsNumber, validity } = event.currentTarget;
            setTempoDraft(value);
            if (value && validity.valid) playback.setBpm(valueAsNumber);
          }}
          onBlur={() => setTempoDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              setTempoDraft(null);
            }
          }}
        />
        <span>BPM</span>
        <button type="button" className={styles.playbackButton} aria-label="恢复曲谱速度" disabled={!adjusted}
          onClick={restoreTempo}>恢复</button>
        <div id={tempoNoteId} className={styles.playbackDetails}>
          <span>{playback.savedBpm === null ? `曲谱未设置速度，默认 ${scoreBpm} BPM` : `曲谱速度 ${scoreBpm} BPM`}</span>
        </div>
      </div>
      <div className={`${styles.playbackDetails} ${styles.playbackStatus}`}>
        <strong>{playbackStatus}</strong>
        {position && <span>第 {position.measureIndex + 1} 小节</span>}
      </div>
      <AuditionMetronomeControls playback={playback} onRestore={restoreTempo} />
    </div>
  );
};
