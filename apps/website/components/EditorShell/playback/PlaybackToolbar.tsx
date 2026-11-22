"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { MAX_PLAYBACK_BPM, MIN_PLAYBACK_BPM } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import styles from "../workspace/EditorToolbar.module.scss";

export const PlaybackToolbar = ({ playback, onExit }: {
  playback: ScorePlaybackControls;
  onExit: () => void;
}) => {
  const { phase, position } = playback;
  const active = phase === "loading" || phase === "playing" || phase === "paused";
  const playLabel = { idle: "播放", loading: "加载中…", playing: "暂停", paused: "继续", error: "重试" }[phase];
  const playButton = useRef<HTMLButtonElement>(null);
  const [tempoDraft, setTempoDraft] = useState<string | null>(null);
  useEffect(() => {
    // Focus can synchronously dismiss the previous toolbar's floating controls.
    const frame = requestAnimationFrame(() => playButton.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      id="editor-playback-controls"
      className={styles.content}
      role="group"
      aria-label="木吉他试听工具"
      aria-describedby="editor-playback-description"
      data-editor-associated-panel="music-text-sidebar"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onExit();
        }
      }}
    >
      <span id="editor-playback-description" className={styles.hint}>试听以已提交的六线谱为准。</span>
      <div className={`${styles.row} ${styles.primary}`}>
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
      </div>
      <div className={`${styles.row} ${styles.secondary}`}>
        <label className={styles.playbackTempo}>
          <span aria-hidden="true">♩ =</span>
          <input className={styles.playbackField} type="number" min={MIN_PLAYBACK_BPM} max={MAX_PLAYBACK_BPM} step={1} disabled={active}
            aria-label="速度，每分钟四分音符数" value={tempoDraft ?? playback.bpm}
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
        </label>
        <button type="button" className={styles.playbackButton} aria-pressed={playback.follow} onClick={() => playback.setFollow(!playback.follow)}>跟随谱面</button>
        {position && <span className={styles.playbackPosition}>第 {position.measureIndex + 1} 小节</span>}
      </div>
    </div>
  );
};
