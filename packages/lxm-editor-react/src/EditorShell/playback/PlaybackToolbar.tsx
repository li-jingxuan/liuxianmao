"use client";

import { useEffect, useRef, useState } from "react";
import { Dropdown, Select } from "antd";
import { ChevronDown, LocateFixed, Pause, Play, Square, StepBack, StepForward, Volume2, VolumeX } from "lucide-react";
import { DEFAULT_PLAYBACK_BPM, JUMP_MARK_LABEL, MAX_PLAYBACK_BPM, MIN_PLAYBACK_BPM, type PlaybackRepeatEndingIssue } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import { AuditionMetronomeControls } from "./MetronomeControls";
import { useEditorIdPrefix } from "../session/EditorSessionRuntime";
import styles from "../workspace/EditorToolbar.module.scss";

export const PlaybackToolbar = ({ playback, onRepairJumpMark, onRepairRepeatEnding }: {
  playback: ScorePlaybackControls;
  onRepairJumpMark: (markId: string) => void;
  onRepairRepeatEnding: (issue: PlaybackRepeatEndingIssue) => void;
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
  const playbackStatus = playback.jumpEnd || phase === "idle" && position ? "试听结束" : phase === "playing" ? "正在试听" : phase === "paused" ? "试听已暂停"
    : phase === "loading" ? "正在准备试听" : adjusted ? "临时调速试听" : "按曲谱速度试听";
  const startValue = playback.startOptions.find(({ measureId }) => measureId === playback.startMeasureId)?.value ?? 0;
  const route = playback.jumpRoute;
  const current = route?.visits.findIndex(({ visitIndex }) => visitIndex === position?.visitIndex) ?? -1;
  const previous = route?.visits[current - 1];
  const next = current < 0 ? undefined : route?.visits[current + 1];
  const issue = playback.jumpIssue ?? route?.jumpIssue;
  const repeatIssue = playback.repeatEndingIssue ?? route?.repeatEndingIssue;
  const startSkipped = playback.startMeasureId !== null && route && !route.visits.some(({ measureId }) => measureId === playback.startMeasureId);
  // 保留原来的两小节片段试听能力，按真实计划中的相邻到访截取跳出和落点。
  const jumps = route?.visits.flatMap((visit, index) => {
    const from = route.visits[index - 1];
    if (!from || !visit.jump) return [];
    return [{ key: String(visit.visitIndex), label: `${JUMP_MARK_LABEL[visit.jump.kind]} · ${from.measureIndex + 1} → ${visit.measureIndex + 1}`,
      onClick: () => playback.playVisits(from.visitIndex, visit.visitIndex) }];
  });

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
        <button type="button" className={styles.playbackButton} title="上一步" aria-label="上一步" disabled={!previous || phase === "loading"}
          onClick={() => previous && playback.playVisits(previous.visitIndex)}><StepBack size={15} aria-hidden="true" /></button>
        <button type="button" className={styles.playbackButton} title="下一步" aria-label="下一步" disabled={!next || phase === "loading"}
          onClick={() => next && playback.playVisits(next.visitIndex)}><StepForward size={15} aria-hidden="true" /></button>
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
        <div id={tempoNoteId} className={styles.hint}>
          <span>{playback.savedBpm === null ? `曲谱未设置速度，默认 ${scoreBpm} BPM` : `曲谱速度 ${scoreBpm} BPM`}</span>
        </div>
      </div>
      <div className={styles.playbackGroup} role="group" aria-label="试听选项">
        <button type="button" className={styles.playbackButton} title="跟随谱面" aria-label="跟随谱面" aria-pressed={playback.follow}
          onClick={playback.follow ? playback.suspendFollow : playback.resumeFollow}><LocateFixed size={15} aria-hidden="true" /></button>
        <button type="button" className={styles.playbackButton} title="木吉他声音" aria-label="木吉他声音" aria-pressed={!playback.guitarMuted}
          onClick={() => playback.setGuitarMuted(!playback.guitarMuted)}>
          {playback.guitarMuted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
        </button>
      </div>
      {!!jumps?.length && <Dropdown trigger={["click"]} autoFocus menu={{ items: jumps }}>
        <button type="button" className={styles.playbackButton} aria-haspopup="menu" disabled={phase === "loading"}>
          试听单次跳转<ChevronDown size={14} aria-hidden="true" />
        </button>
      </Dropdown>}
      <div className={`${styles.playbackDetails} ${styles.playbackStatus}`}>
        <strong>{playbackStatus}</strong>
        {position && <span>第 {position.measureIndex + 1} 小节{current >= 0 && ` · 到访 ${current + 1}/${route?.visits.length}`}</span>}
        {playback.jumpEnd && <span role="status" data-jump-playback-end={playback.jumpEnd.kind}>
          {playback.jumpEnd.kind === "fine" ? "Fine · 重奏结束" : "曲尾 · 试听结束"}
        </span>}
      </div>
      <AuditionMetronomeControls playback={playback} onRestore={restoreTempo} />
      {startSkipped && <div className={styles.playbackNotice}>
        <span>演奏路线未到访当前起点，将从曲首试听。</span>
        <button type="button" className={styles.playbackButton} disabled={active} onClick={() => playback.setStartMeasure(null)}>从曲首</button>
      </div>}
      {issue && <div className={styles.playbackNotice} data-jump-playback-issue>
        <span>{`第 ${issue.measureIndex + 1} 小节${playback.jumpIssue ? "已暂停" : "弹完后暂停"}。${issue.message}。`}</span>
        <button type="button" className={styles.playbackButton} onClick={() => onRepairJumpMark(issue.repairMarkId)}>返回编辑并定位</button>
      </div>}
      {repeatIssue && <div className={styles.playbackNotice} data-repeat-ending-playback-issue>
        <span>{`第 ${repeatIssue.measureIndex + 1} 小节${playback.repeatEndingIssue ? "已暂停" : "弹完后暂停"}。${repeatIssue.message}。`}</span>
        <button type="button" className={styles.playbackButton} onClick={() => repeatIssue.repairMarkId
          ? onRepairJumpMark(repeatIssue.repairMarkId) : onRepairRepeatEnding(repeatIssue)}>
          {repeatIssue.repairMarkId ? "返回编辑跳转记号" : "返回编辑反复房子"}
        </button>
      </div>}
    </div>
  );
};
