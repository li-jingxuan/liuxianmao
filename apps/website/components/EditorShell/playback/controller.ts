"use client";

import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  createPlaybackPlan,
  DEFAULT_PLAYBACK_BPM,
  getPlaybackBeatAtTick,
  MAX_PLAYBACK_BPM,
  MIN_PLAYBACK_BPM,
  type ILXMDocument,
  type ILXMTimeSignature,
  type PlaybackPlan,
  type PlaybackWarningCode,
} from "@liuxianmao/lxm-editor";
import { chordCatalogResource } from "../chords/chord-catalog-resource";
import { ScoreAudioEngine } from "./engine";
import { createScoreMetronomeGrid, DEFAULT_METER, isMetronomeBpm, readMeter, type ScoreMetronomeGrid } from "./metronome-grid";

type Position = {
  measureId: string;
  beatId: string;
  measureIndex: number;
  visitIndex: number;
};
interface SessionState {
  enabled: boolean;
  phase: "idle" | "loading" | "playing" | "paused" | "error";
  bpm: number;
  savedBpm: number | null;
  startMeasureId: string | null;
  follow: boolean;
  position: Position | null;
  message: string;
  clickEnabled: boolean;
  clickAccent: boolean;
  clickBeat: number | null;
  clickFailed: boolean;
  currentMeter: ILXMTimeSignature | null;
}
export interface ScorePlaybackControls extends SessionState {
  setEnabled(enabled: boolean): void;
  setBpm(bpm: number): void;
  resetBpm(): void;
  setStartMeasure(measureId: string | null): void;
  suspendFollow(): void;
  startOptions: { value: number; label: string; measureId: string | null }[];
  togglePlay(): void;
  stop(): void;
  setClickEnabled(enabled: boolean): void;
  setClickAccent(accent: boolean): void;
  startingMeter: ILXMTimeSignature;
}

// The editor also commits display, numbered notation and lyric edits to this document.
// Only compare values read by the TAB performance while a request or plan is active.
function performanceKey(doc: ILXMDocument | null) {
  const track = doc?.score.tracks[0];
  if (!track) return "";
  return JSON.stringify([
    doc.score.id,
    track.id,
    track.tuning.strings.map((s) => [s.index, s.midi]),
    track.capo,
    track.startBarline,
    track.techniques,
    track.measures.map((m) => [
      m.id,
      m.barline,
      m.timeSignature,
      m.actualDurationTicks,
      m.tuplets,
      m.beats.map((b) => [b.id, b.tick, b.rhythm, b.kind, b.notes]),
      m.chordSymbols.map((s) => [
        s.beatId,
        s.chord.diagram
          ? s.chord.diagram.strings.map((p) => [p.string, p.fret])
          : s.chord.name,
      ]),
    ]),
  ]);
}

const warningText: Record<PlaybackWarningCode, string> = {
  missingChordVoicing: "部分和弦缺少指法，已跳过相应弦音",
  outOfRangePitch: "部分音高超出范围，已跳过",
  invalidRepeat: "反复线无法配对，按书写顺序播放",
  invalidConnection: "部分连接技巧无法按谱演奏",
  approximateHarmonic: "部分泛音使用近似音高",
  conflictingTechnique: "部分技巧方向冲突，已取单一方向",
};
function planMessage(plan: PlaybackPlan) {
  const numbers = new Map(
    plan.visits.map((v) => [v.measureId, v.measureIndex + 1]),
  );
  return plan.warnings
    .map((warning) => {
      const measures = warning.measureIds
        .map((id) => numbers.get(id))
        .filter((n) => n !== undefined);
      const range =
        measures.slice(0, 4).join("、") + (measures.length > 4 ? "等" : "");
      return (range ? `第 ${range} 小节` : "") + warningText[warning.code];
    })
    .join("；");
}

export class PlaybackSession {
  private state: SessionState = {
    enabled: false,
    phase: "idle",
    bpm: DEFAULT_PLAYBACK_BPM,
    savedBpm: null,
    startMeasureId: null,
    follow: true,
    position: null,
    message: "",
    clickEnabled: false,
    clickAccent: true,
    clickBeat: null,
    clickFailed: false,
    currentMeter: null,
  };
  private listeners = new Set<() => void>();
  private engine: ScoreAudioEngine | null = null;
  private request: AbortController | null = null;
  private key: string | null = null;
  private plan: PlaybackPlan | null = null;
  private clickGrid: ScoreMetronomeGrid | null = null;
  private clickFromTick = 0;
  private resumeSkipsOnset = false;
  private documentKey?: string;
  private offset = 0;
  private frame = 0;

  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(change: Partial<SessionState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((fn) => fn());
  }
  private cancel() {
    this.request?.abort();
    this.request = null;
    cancelAnimationFrame(this.frame);
    this.engine?.stop();
  }
  stop = (message = "") => {
    this.cancel();
    this.plan = null;
    this.clickGrid = null;
    this.key = null;
    this.offset = 0;
    this.clickFromTick = 0;
    this.resumeSkipsOnset = false;
    this.update({
      phase: "idle",
      message,
      position: null,
      clickBeat: null,
      clickFailed: false,
      currentMeter: null,
      // 手动滚动只让出本轮播放的视口。停播、播完或失败后，下轮起播重新自动跟随。
      follow: true,
    });
  };
  dispose = () => {
    this.cancel();
    this.engine?.dispose();
    this.engine = null;
  };
  documentChanged(doc: ILXMDocument | null, documentKey?: string) {
    const value = doc?.score.tempoBpm;
    const savedBpm = isMetronomeBpm(value) ? value : null;
    // 文件会话版本只在真正换谱后变化。即使重新导入的是同一 ID 或打开后又取消确认，也不会误用旧试听配置。
    if (documentKey !== undefined && documentKey !== this.documentKey) {
      const replaced = this.documentKey !== undefined;
      this.documentKey = documentKey;
      if (replaced) {
        this.stop();
        this.update({ savedBpm, bpm: savedBpm ?? DEFAULT_PLAYBACK_BPM, startMeasureId: null, clickEnabled: this.state.enabled, clickAccent: true });
        return;
      }
    }
    const { bpm: previousBpm, savedBpm: previousSavedBpm } = this.state;
    const overridden = previousBpm !== (previousSavedBpm ?? DEFAULT_PLAYBACK_BPM);
    const bpm = overridden ? previousBpm : savedBpm ?? DEFAULT_PLAYBACK_BPM;
    // 显示开关不参与音频状态。已应用速度变化时，仅使受影响的播放计划失效。
    if (this.key !== null && (bpm !== previousBpm || this.key !== performanceKey(doc)))
      this.stop("谱面已更新，请重新播放");
    if (savedBpm !== previousSavedBpm) this.update({ savedBpm, bpm });
  }
  setEnabled = (enabled: boolean) => {
    // 停止可用相同的临时速度再次试听，退出试听则开始新的会话。
    if (!enabled) {
      this.stop();
      this.resetBpm();
    }
    // 每次进入试听时默认启用随谱点击音。停播保留本轮选择，退出后清除试听起点与开关状态。
    this.update({ enabled, message: "", startMeasureId: null, clickEnabled: enabled });
  };
  private get editable() {
    return this.state.phase === "idle" || this.state.phase === "error";
  }
  setBpm = (value: number) => {
    if (!Number.isFinite(value)) return;
    const bpm = Math.max(MIN_PLAYBACK_BPM, Math.min(MAX_PLAYBACK_BPM, Math.round(value)));
    if (bpm === this.state.bpm) return;
    try {
      if (this.state.phase === "playing" && this.plan) this.engine?.changeTempo(this.plan, bpm);
      // 加载时更新目标速度；异步音源就绪后使用最新值。暂停时保留原来的刻度，继续时应用新速度。
      this.update({ bpm });
    } catch (error) {
      this.update({ bpm });
      this.fail(error);
    }
  };
  resetBpm = () => this.setBpm(this.state.savedBpm ?? DEFAULT_PLAYBACK_BPM);
  setStartMeasure = (startMeasureId: string | null) => {
    // 起点同时驱动下拉和谱面高亮。加载、播放和暂停期间锁定，以免更改已建立的播放计划或续播位置。
    if (this.state.enabled && this.editable && startMeasureId !== this.state.startMeasureId)
      this.update({ startMeasureId });
  };
  suspendFollow = () => {
    if (this.state.follow) this.update({ follow: false });
  };
  setClickEnabled = (enabled: boolean) => {
    if (!this.state.enabled || this.state.clickEnabled === enabled) return;
    if (this.state.phase === "playing" && this.engine) {
      this.update({ clickEnabled: enabled, clickBeat: null, clickFailed: false });
      this.clickFromTick = this.engine.setClickEnabled(enabled);
      return;
    }
    // 暂停或继续加载中打开时，同样从尚未经过的自然拍点加入。已停播则下次从起点开始。
    this.clickFromTick = enabled && this.clickGrid
      ? this.clickGrid.nextBeat(this.offset, !this.resumeSkipsOnset)?.tick ?? Infinity : 0;
    this.update({ clickEnabled: enabled, clickBeat: null, clickFailed: false });
  };
  setClickAccent = (accent: boolean) => {
    this.engine?.setClickAccent(accent);
    this.update({ clickAccent: accent });
  };
  private visibleBeat(tick: number) {
    if (!this.state.clickEnabled) return null;
    const beat = this.clickGrid?.beatAt(tick);
    return beat && beat.tick >= this.clickFromTick ? beat.number : null;
  }
  private paint = () => {
    if (!this.engine || !this.plan || this.state.phase !== "playing") return;
    const tick = this.engine.currentTick();
    if (tick >= this.plan.durationTicks) {
      this.stop();
      return;
    }
    const position = getPlaybackBeatAtTick(this.plan, tick) ?? null;
    const currentMeter = this.clickGrid?.meterAt(tick) ?? null;
    const clickBeat = this.engine.hasStarted() ? this.visibleBeat(tick) : this.state.clickBeat;
    if (this.state.position !== position || this.state.currentMeter !== currentMeter || this.state.clickBeat !== clickBeat)
      this.update({ position, currentMeter, clickBeat });
    this.frame = requestAnimationFrame(this.paint);
  };
  pause = (message?: string, interrupted = false) => {
    if (this.state.phase === "loading") {
      this.stop(message);
      return;
    }
    if (this.state.phase !== "playing" || !this.engine || !this.plan) return;
    this.offset = this.engine.currentTick();
    this.resumeSkipsOnset ||= interrupted || this.engine.hasStarted();
    const clickBeat = interrupted ? null : this.resumeSkipsOnset ? this.visibleBeat(this.offset) : this.state.clickBeat;
    if (interrupted) this.clickFromTick = this.clickGrid?.nextBeat(this.offset, false)?.tick ?? Infinity;
    this.cancel();
    this.update({
      phase: "paused",
      position: getPlaybackBeatAtTick(this.plan, this.offset) ?? null,
      currentMeter: this.clickGrid?.meterAt(this.offset) ?? null,
      clickBeat,
      message: message ?? this.state.message,
    });
  };
  private fail(error: unknown) {
    this.stop();
    this.update({ phase: "error", message: error instanceof Error ? `试听失败，请重试。${error.message}` : "试听失败，请重试" });
  }
  async togglePlay(doc: ILXMDocument | null) {
    if (!this.state.enabled || !doc || this.state.phase === "loading") return;
    this.documentChanged(doc);
    if (this.state.phase === "playing") {
      this.pause();
      return;
    }
    const resume = this.state.phase === "paused";
    const { startMeasureId } = this.state;
    const request = new AbortController();
    this.request = request;
    this.key = performanceKey(doc);
    this.update({ phase: "loading", message: "正在准备木吉他音源…" });
    try {
      const engine = (this.engine ??= new ScoreAudioEngine());
      engine.onInterrupted = () => this.pause("音频已中断，可继续播放", true);
      engine.onClickFailed = () => this.update({ clickFailed: true });
      await engine.unlock(request.signal);
      request.signal.throwIfAborted();
      if (!resume || !this.plan) {
        const needsCatalog = doc.score.tracks[0]?.measures.some((m) =>
          m.chordSymbols.some((s) => !s.chord.diagram),
        );
        if (needsCatalog) await chordCatalogResource.ensureLoaded();
        request.signal.throwIfAborted();
        this.plan = createPlaybackPlan(doc, {
          bpm: this.state.bpm,
          startMeasureId: startMeasureId ?? undefined,
          chordCatalog: chordCatalogResource.getSnapshot().catalog,
        });
        this.clickGrid = createScoreMetronomeGrid(this.plan, doc.score.tracks[0]?.measures ?? []);
        this.offset = 0;
      }
      const plan = this.plan;
      if (!plan.sounds.length) {
        this.stop(
          ["这段六线谱没有可播放的音符", planMessage(plan)]
            .filter(Boolean)
            .join("。"),
        );
        return;
      }
      await engine.prepare(plan, request.signal);
      request.signal.throwIfAborted();
      this.update({ clickFailed: false });
      engine.start(plan, this.state.bpm, this.offset, this.clickGrid ? {
        grid: this.clickGrid, enabled: this.state.clickEnabled,
        accent: this.state.clickAccent, skipOnset: resume && this.resumeSkipsOnset,
      } : undefined);
      this.update({ phase: "playing", message: planMessage(plan) });
      this.paint();
    } catch (error) {
      if (request.signal.aborted) return;
      this.fail(error);
    }
  }
}

export function useScorePlayback(
  doc: ILXMDocument | null,
  documentKey?: string,
): ScorePlaybackControls {
  const [session] = useState(() => new PlaybackSession());
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  useLayoutEffect(() => {
    session.documentChanged(doc, documentKey);
  }, [session, doc, documentKey]);
  useLayoutEffect(() => {
    const hidden = () => {
      if (document.hidden) session.pause("页面已切至后台，试听已中断");
    };
    // pagehide 只在离开成功后触发，也覆盖浏览器保留页面实例用于后退的情形。
    const leave = () => { session.setEnabled(false); session.setClickAccent(true); session.dispose(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      session.dispose();
    };
  }, [session]);
  const measures = doc?.score.tracks[0]?.measures;
  // 下拉值使用显示序号，0 专供谱首选项，避免与导入曲谱中任意字符串形式的小节 ID 冲突。
  const startOptions = useMemo(() => [
    { value: 0, label: "从头开始", measureId: null },
    ...(measures?.map((measure, index) => ({ value: index + 1, label: `从第 ${index + 1} 小节开始`, measureId: measure.id })) ?? []),
  ], [measures]);
  const selectedMeasure = state.startMeasureId === null ? undefined : measures?.find((measure) => measure.id === state.startMeasureId);
  return {
    ...state,
    // 文档内容更新导致起点小节消失时，显示与播放计划一致的谱首回退，也用谱首拍号预览节拍器。
    startMeasureId: selectedMeasure?.id ?? null,
    setEnabled: session.setEnabled,
    suspendFollow: session.suspendFollow,
    setStartMeasure: session.setStartMeasure,
    setBpm: session.setBpm,
    resetBpm: session.resetBpm,
    setClickEnabled: session.setClickEnabled,
    setClickAccent: session.setClickAccent,
    startingMeter: readMeter((selectedMeasure ?? measures?.[0])?.timeSignature) ?? DEFAULT_METER,
    startOptions,
    togglePlay: () => {
      void session.togglePlay(doc);
    },
    stop: () => session.stop(),
  };
}
