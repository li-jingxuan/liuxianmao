"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  createPlaybackPlan,
  DEFAULT_PLAYBACK_BPM,
  getPlaybackBeatAtTick,
  MAX_PLAYBACK_BPM,
  MIN_PLAYBACK_BPM,
  type ILXMDocument,
  type PlaybackPlan,
  type PlaybackWarningCode,
} from "@liuxianmao/lxm-editor";
import { chordCatalogResource } from "../chords/chord-catalog-resource";
import { ScoreAudioEngine } from "./engine";

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
  start: "beginning" | "current";
  follow: boolean;
  position: Position | null;
  message: string;
}
export interface ScorePlaybackControls extends SessionState {
  setEnabled(enabled: boolean): void;
  setBpm(bpm: number): void;
  resetBpm(): void;
  setStart(start: SessionState["start"]): void;
  setFollow(follow: boolean): void;
  suspendFollow(): void;
  canStartCurrent: boolean;
  togglePlay(): void;
  stop(): void;
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
    start: "beginning",
    follow: true,
    position: null,
    message: "",
  };
  private listeners = new Set<() => void>();
  private engine: ScoreAudioEngine | null = null;
  private request: AbortController | null = null;
  private key: string | null = null;
  private plan: PlaybackPlan | null = null;
  private offset = 0;
  private frame = 0;
  private preferredFollow = true;

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
    this.key = null;
    this.offset = 0;
    this.update({
      phase: "idle",
      message,
      position: null,
      follow: this.preferredFollow,
    });
  };
  dispose = () => {
    this.cancel();
    this.engine?.dispose();
    this.engine = null;
  };
  documentChanged(doc: ILXMDocument | null) {
    const savedBpm = doc?.score.tempoBpm ?? null;
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
    this.update({ enabled, message: "" });
  };
  private get editable() {
    return this.state.phase === "idle" || this.state.phase === "error";
  }
  setBpm = (value: number) => {
    if (this.editable && Number.isFinite(value))
      this.update({
        bpm: Math.max(
          MIN_PLAYBACK_BPM,
          Math.min(MAX_PLAYBACK_BPM, Math.round(value)),
        ),
      });
  };
  resetBpm = () => this.setBpm(this.state.savedBpm ?? DEFAULT_PLAYBACK_BPM);
  setStart = (start: SessionState["start"]) => {
    if (this.editable) this.update({ start });
  };
  setFollow = (follow: boolean) => {
    this.preferredFollow = follow;
    this.update({ follow });
  };
  suspendFollow = () => {
    if (this.state.follow) this.update({ follow: false });
  };
  private paint = () => {
    if (!this.engine || !this.plan || this.state.phase !== "playing") return;
    const tick = this.engine.currentTick();
    if (tick >= this.plan.durationTicks) {
      this.stop();
      return;
    }
    const position = getPlaybackBeatAtTick(this.plan, tick) ?? null;
    if (this.state.position !== position) this.update({ position });
    this.frame = requestAnimationFrame(this.paint);
  };
  pause = (message?: string) => {
    if (this.state.phase === "loading") {
      this.stop(message);
      return;
    }
    if (this.state.phase !== "playing" || !this.engine || !this.plan) return;
    this.offset = this.engine.currentTick();
    this.cancel();
    this.update({
      phase: "paused",
      position: getPlaybackBeatAtTick(this.plan, this.offset) ?? null,
      message: message ?? this.state.message,
    });
  };
  async togglePlay(doc: ILXMDocument | null, currentMeasure: string | null) {
    if (!this.state.enabled || !doc || this.state.phase === "loading") return;
    this.documentChanged(doc);
    if (this.state.phase === "playing") {
      this.pause();
      return;
    }
    const resume = this.state.phase === "paused";
    const { start, bpm } = this.state;
    if (!resume && start === "current" && !currentMeasure) {
      this.stop("请先选择一个六线谱小节");
      return;
    }
    const request = new AbortController();
    this.request = request;
    this.key = performanceKey(doc);
    this.update({ phase: "loading", message: "正在准备木吉他音源…" });
    try {
      const engine = (this.engine ??= new ScoreAudioEngine());
      engine.onInterrupted = () => this.pause("音频已中断，可继续播放");
      await engine.unlock();
      request.signal.throwIfAborted();
      if (!resume || !this.plan) {
        const needsCatalog = doc.score.tracks[0]?.measures.some((m) =>
          m.chordSymbols.some((s) => !s.chord.diagram),
        );
        if (needsCatalog) await chordCatalogResource.ensureLoaded();
        request.signal.throwIfAborted();
        this.plan = createPlaybackPlan(doc, {
          bpm,
          startMeasureId: start === "current" ? currentMeasure! : undefined,
          chordCatalog: chordCatalogResource.getSnapshot().catalog,
        });
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
      engine.start(plan, bpm, this.offset);
      this.update({ phase: "playing", message: planMessage(plan) });
      this.paint();
    } catch (error) {
      if (request.signal.aborted) return;
      this.stop();
      this.update({
        phase: "error",
        message:
          error instanceof Error
            ? `试听失败，请重试。${error.message}`
            : "试听失败，请重试",
      });
    }
  }
}

export function useScorePlayback(
  doc: ILXMDocument | null,
  selectedMeasureId: string | null,
): ScorePlaybackControls {
  const [session] = useState(() => new PlaybackSession());
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  useLayoutEffect(() => {
    session.documentChanged(doc);
  }, [session, doc]);
  useLayoutEffect(() => {
    const hidden = () => {
      if (document.hidden) session.pause("页面已切至后台，试听已中断");
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      session.dispose();
    };
  }, [session]);
  const canStartCurrent =
    !!selectedMeasureId &&
    !!doc?.score.tracks[0]?.measures.some((m) => m.id === selectedMeasureId);
  return {
    ...state,
    setEnabled: session.setEnabled,
    setFollow: session.setFollow,
    suspendFollow: session.suspendFollow,
    setStart: session.setStart,
    setBpm: session.setBpm,
    resetBpm: session.resetBpm,
    canStartCurrent,
    togglePlay: () => {
      void session.togglePlay(doc, canStartCurrent ? selectedMeasureId : null);
    },
    stop: () => session.stop(),
  };
}
