"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { DEFAULT_PLAYBACK_BPM, MAX_PLAYBACK_BPM, MIN_PLAYBACK_BPM } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import styles from "../workspace/EditorToolbar.module.scss";

export const PlaybackToolbar = ({ playback }: {
  playback: ScorePlaybackControls;
}) => {
  const { phase, position } = playback;
  const active = phase === "loading" || phase === "playing" || phase === "paused";
  const playLabel = { idle: "播放", loading: "加载中…", playing: "暂停", paused: "继续", error: "重试" }[phase];
  const [tempoDraft, setTempoDraft] = useState<string | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 等编辑工具完成卸载再交接焦点，避免残留的浮层在 React 提交期间处理焦点离开。
    const frame = requestAnimationFrame(() => playButton.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const scoreBpm = playback.savedBpm ?? DEFAULT_PLAYBACK_BPM;
  const adjusted = playback.bpm !== scoreBpm;
  // 常用速度使用较细的滑杆范围。已应用或手动输入的极值也必须能在滑杆上正确显示和恢复。
  const sliderMin = Math.min(40, scoreBpm, playback.bpm);
  const sliderMax = Math.max(180, scoreBpm, playback.bpm);
  const playbackStatus = phase === "playing" ? "正在试听" : phase === "paused" ? "试听已暂停"
    : phase === "loading" ? "正在准备试听" : adjusted ? "临时调速试听" : "按曲谱速度试听";

  return (
    <div
      id="editor-playback-controls"
      className={styles.playbackControls}
      role="group"
      aria-label="木吉他试听工具"
      aria-describedby="editor-playback-description"
    >
      <span id="editor-playback-description" className={styles.hint}>试听以已提交的六线谱为准。</span>
      <div className={styles.playbackGroup}>
        <button ref={playButton} type="button" className={`${styles.playbackButton} ${styles.playbackPrimary}`} aria-disabled={phase === "loading" || undefined}
          onClick={() => { if (phase !== "loading") playback.togglePlay(); }}>
          {phase === "playing" ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {playLabel}
        </button>
        <button type="button" className={styles.playbackButton} disabled={!active && phase !== "error"} onClick={playback.stop}>
          <Square size={14} aria-hidden="true" />停止
        </button>
        <select className={styles.playbackField} aria-label="播放起点" disabled={active} value={playback.start}
          onChange={(event) => playback.setStart(event.target.value === "current" ? "current" : "beginning")}>
          <option value="beginning">从头开始</option>
          <option value="current" disabled={!active && !playback.canStartCurrent}>从当前小节</option>
        </select>
        <button type="button" className={styles.playbackButton} aria-pressed={playback.follow} onClick={() => playback.setFollow(!playback.follow)}>跟随谱面</button>
      </div>
      <div className={`${styles.playbackGroup} ${styles.playbackTempoGroup}`}>
        <label htmlFor="editor-playback-bpm">临时调速</label>
        <input className={styles.playbackSlider} type="range" aria-label="临时调速" aria-describedby="editor-playback-tempo-note" min={sliderMin} max={sliderMax}
          step={1} value={playback.bpm} disabled={active} onChange={(event) => playback.setBpm(event.currentTarget.valueAsNumber)} />
        <input id="editor-playback-bpm" className={`${styles.playbackField} ${styles.playbackTempo}`} type="number" min={MIN_PLAYBACK_BPM} max={MAX_PLAYBACK_BPM} step={1} disabled={active}
          aria-label="速度，每分钟四分音符数" aria-describedby="editor-playback-tempo-note" value={tempoDraft ?? playback.bpm}
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
        <button type="button" className={styles.playbackButton} disabled={!adjusted || active}
          onClick={() => { setTempoDraft(null); playback.resetBpm(); }}>恢复曲谱速度</button>
        <div id="editor-playback-tempo-note" className={styles.playbackDetails}>
          <span>{playback.savedBpm === null ? `曲谱未设置速度，默认 ${scoreBpm} BPM` : `曲谱速度 ${scoreBpm} BPM`}</span>
          <span>临时调速仅影响本次试听</span>
        </div>
      </div>
      <div className={`${styles.playbackDetails} ${styles.playbackStatus}`}>
        <strong>{playbackStatus}</strong>
        <span>{position ? `第 ${position.measureIndex + 1} 小节` : playback.start === "current" ? "从当前小节开始" : "从第 1 小节开始"}</span>
      </div>
    </div>
  );
};
