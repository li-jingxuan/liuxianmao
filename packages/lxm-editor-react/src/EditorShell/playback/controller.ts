"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import {
  createPlaybackPlan,
  DEFAULT_PLAYBACK_BPM,
  getPlaybackBeatAtTick,
  MAX_PLAYBACK_BPM,
  MIN_PLAYBACK_BPM,
  type ILXMDocument,
  type ILXMTimeSignature,
  type PlaybackPlan,
  type PlaybackJumpEnd,
  type PlaybackJumpIssue,
  type PlaybackRepeatEndingIssue,
  type PlaybackWarningCode,
} from "@liuxianmao/lxm-editor";
import { chordCatalogResource } from "../chords/chord-catalog-resource";
import { useEditorResources } from "../../resources/editor-resources";
import { bundledGuitarSamples, type BundledGuitarSamples } from "../../resources/bundled-assets";
import { ScoreAudioEngine } from "./engine";
import { createScoreMetronomeGrid, DEFAULT_METER, isMetronomeBpm, readMeter, type ScoreMetronomeGrid } from "./metronome-grid";

type Position = {
  measureId: string;
  beatId?: string;
  measureIndex: number;
  visitIndex: number;
  measureEnd?: boolean;
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
  jumpIssue?: PlaybackJumpIssue;
  repeatEndingIssue?: PlaybackRepeatEndingIssue;
  jumpEnd?: PlaybackJumpEnd;
  guitarMuted: boolean;
}
type VisitFragment = { first: number; last: number };
export interface ScorePlaybackControls extends SessionState {
  setEnabled(enabled: boolean): void;
  setBpm(bpm: number): void;
  resetBpm(): void;
  setStartMeasure(measureId: string | null): void;
  suspendFollow(): void;
  resumeFollow(): void;
  setGuitarMuted(muted: boolean): void;
  startOptions: { value: number; label: string; measureId: string | null }[];
  togglePlay(): void;
  stop(): void;
  playVisits(first: number, last?: number): void;
  jumpRoute: Pick<PlaybackPlan, "visits" | "jumpIssue" | "jumpEnd" | "repeatEndingIssue"> | null;
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
    // 重奏端点和小节跳转改变播放顺序，已加载或暂停的计划也需要重新生成。
    track.playbackReplay,
    track.repeatEndingGroups,
    track.techniques,
    track.measures.map((m) => [
      m.id,
      m.barline,
      m.jumpMarks,
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

const hasScoreRoute = (doc: ILXMDocument) => {
  const track = doc.score.tracks[0];
  return Boolean(track?.repeatEndingGroups?.length || track?.measures.some((measure) => measure.jumpMarks?.length));
};

const warningText: Record<PlaybackWarningCode, string> = {
  missingChordVoicing: "部分和弦缺少指法，已跳过相应弦音",
  outOfRangePitch: "部分音高超出范围，已跳过",
  invalidRepeat: "反复线无法配对，按书写顺序播放",
  invalidConnection: "部分连接技巧无法按谱演奏",
  approximateHarmonic: "部分泛音使用近似音高",
  conflictingTechnique: "部分技巧方向冲突，已取单一方向",
};
function planMessage(plan: PlaybackPlan, hasOtherTraversal: boolean) {
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
      // 反复线无效时仍可执行谱件的重奏和跳转指令。
      const text = warning.code === "invalidRepeat" && hasOtherTraversal
        ? "反复线无法配对，已忽略反复线"
        : warningText[warning.code];
      return (range ? `第 ${range} 小节` : "") + text;
    })
    .join("；");
}

function positionAtTick(plan: PlaybackPlan, tick: number, includeGaps: boolean): Position | null {
  const beat = getPlaybackBeatAtTick(plan, tick);
  if (beat || !includeGaps) return beat ?? null;
  let lower = 0;
  let upper = plan.visits.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (plan.visits[middle]!.endTick <= tick) lower = middle + 1;
    else upper = middle;
  }
  const visit = plan.visits[lower];
  return visit && visit.startTick <= tick ? visit : null;
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
    guitarMuted: false,
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
  private fragment = false;
  private hasRoute = false;

  constructor(private readonly chords = chordCatalogResource, private readonly audioDirectory?: string,
    private readonly bundled?: BundledGuitarSamples) {}

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
    this.fragment = false;
    this.update({
      phase: "idle",
      message,
      position: null,
      clickBeat: null,
      clickFailed: false,
      currentMeter: null,
      jumpIssue: undefined,
      repeatEndingIssue: undefined,
      jumpEnd: undefined,
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
      this.setGuitarMuted(false);
    }
    // 每次进入试听时默认启用随谱点击音。停播保留本轮选择，退出后清除试听起点与开关状态。
    this.update({ enabled, message: "", startMeasureId: null, clickEnabled: enabled });
  };
  private get editable() {
    return this.state.phase === "idle" || this.state.phase === "error" || Boolean(this.state.jumpIssue || this.state.repeatEndingIssue);
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
    if (this.state.enabled && this.editable && startMeasureId !== this.state.startMeasureId) {
      if (this.state.jumpIssue || this.state.repeatEndingIssue || this.state.jumpEnd || this.fragment) this.stop();
      this.update({ startMeasureId });
    }
  };
  suspendFollow = () => {
    if (this.state.follow) this.update({ follow: false });
  };
  resumeFollow = () => this.update({ follow: true });
  setGuitarMuted = (guitarMuted: boolean) => {
    this.engine?.setGuitarMuted(guitarMuted);
    this.update({ guitarMuted });
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
      const { jumpIssue, repeatEndingIssue, jumpEnd, durationTicks } = this.plan;
      const issue = jumpIssue ?? repeatEndingIssue;
      if (issue || jumpEnd || this.fragment) {
        // 自然结束和异常都已演奏完整个小节。用最后一次到访定位右边界，片段试听继续保留末拍位置。
        const last = this.plan.visits.at(-1);
        const position = (issue || jumpEnd) && last ? { ...last, measureEnd: true } : positionAtTick(this.plan, durationTicks - 1, true);
        this.cancel();
        const message = issue ? `第 ${issue.measureIndex + 1} 小节 · 试听已暂停 · ${issue.message}` : "";
        this.update({ phase: issue ? "paused" : "idle", position, clickBeat: null, jumpIssue, repeatEndingIssue, jumpEnd, message });
      } else {
        this.stop();
      }
      return;
    }
    const position = positionAtTick(this.plan, tick, this.hasRoute);
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
      position: positionAtTick(this.plan, this.offset, this.hasRoute),
      currentMeter: this.clickGrid?.meterAt(this.offset) ?? null,
      clickBeat,
      message: message ?? this.state.message,
    });
  };
  private fail(error: unknown) {
    this.stop();
    this.update({ phase: "error", message: error instanceof Error ? `试听失败，请重试。${error.message}` : "试听失败，请重试" });
  }
  async togglePlay(doc: ILXMDocument | null, fragment?: VisitFragment) {
    if (!this.state.enabled || !doc || this.state.phase === "loading") return;
    this.documentChanged(doc);
    if (fragment) {
      const { follow } = this.state;
      this.stop();
      if (!follow) this.suspendFollow();
    } else if (this.state.phase === "playing") {
      this.pause();
      return;
    }
    const resume = this.state.phase === "paused" && !this.state.jumpIssue && !this.state.repeatEndingIssue;
    const { startMeasureId } = this.state;
    const request = new AbortController();
    this.request = request;
    this.key = performanceKey(doc);
    this.hasRoute = hasScoreRoute(doc);
    this.update({ phase: "loading", jumpIssue: undefined, repeatEndingIssue: undefined, jumpEnd: undefined,
      message: "正在准备木吉他音源…" });
    try {
      const engine = (this.engine ??= new ScoreAudioEngine(undefined, this.audioDirectory, this.bundled));
      engine.onInterrupted = () => this.pause("音频已中断，可继续播放", true);
      engine.onClickFailed = () => this.update({ clickFailed: true });
      await engine.unlock(request.signal);
      engine.setGuitarMuted(this.state.guitarMuted);
      request.signal.throwIfAborted();
      if (!resume || !this.plan) {
        const needsCatalog = doc.score.tracks[0]?.measures.some((m) =>
          m.chordSymbols.some((s) => !s.chord.diagram),
        );
        if (needsCatalog) await this.chords.ensureLoaded();
        request.signal.throwIfAborted();
        const fullPlan = createPlaybackPlan(doc, {
          bpm: this.state.bpm,
          startMeasureId: startMeasureId ?? undefined,
          chordCatalog: this.chords.getSnapshot().catalog,
        });
        this.plan = fullPlan;
        this.fragment = Boolean(fragment);
        this.offset = 0;
        if (fragment) {
          const visits = fullPlan.visits.filter(({ visitIndex }) => visitIndex >= fragment.first && visitIndex <= fragment.last);
          const first = visits[0];
          const last = visits.at(-1);
          if (!first || !last) { this.stop(); return; }
          this.offset = first.startTick;
          // 保留完整计划的到访 ID 和拍点刻度。仅裁掉片段外的音符和点击，游标仍读取同一时间轴。
          this.plan = {
            ...fullPlan, visits, durationTicks: last.endTick, jumpIssue: undefined, repeatEndingIssue: undefined, jumpEnd: undefined,
            beats: fullPlan.beats.filter((beat) => beat.visitIndex >= first.visitIndex && beat.visitIndex <= last.visitIndex),
            sounds: fullPlan.sounds.filter((sound) => sound.startTick < last.endTick && sound.endTick > first.startTick)
              .map((sound) => ({ ...sound, endTick: Math.min(sound.endTick, last.endTick) })),
          };
        }
        this.clickGrid = createScoreMetronomeGrid(this.plan, doc.score.tracks[0]?.measures ?? []);
      }
      const plan = this.plan;
      const message = planMessage(plan, this.hasRoute || Boolean(doc.score.tracks[0]?.playbackReplay));
      if (!plan.sounds.length && !this.fragment && !this.hasRoute) {
        this.stop(
          ["这段六线谱没有可播放的音符", message]
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
      this.update({ phase: "playing", message });
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
  const { paths, chords } = useEditorResources();
  const audioDirectory = paths?.audioDirectory ?? (paths?.basePath === undefined
    ? undefined : `${paths.basePath}/assets/audio/meta-steel-guitar-v1`);
  // URL 改变时中止旧采样请求，并用当前工作区资源实例建立新播放器。
  const session = useMemo(() => new PlaybackSession(chords, audioDirectory, audioDirectory === undefined ? bundledGuitarSamples : undefined), [chords, audioDirectory]);
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
  const jumpRoute = useMemo(() => {
    if (!state.enabled || !doc || !hasScoreRoute(doc)) return null;
    // 路线可在加载音源前检查，和真正演奏计划共用同一个路径解析器及选中起点。
    const { visits, jumpIssue, jumpEnd, repeatEndingIssue } = createPlaybackPlan(doc, { startMeasureId: state.startMeasureId ?? undefined });
    return { visits, jumpIssue, jumpEnd, repeatEndingIssue };
  }, [doc, state.enabled, state.startMeasureId]);
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
    resumeFollow: session.resumeFollow,
    setGuitarMuted: session.setGuitarMuted,
    setStartMeasure: session.setStartMeasure,
    setBpm: session.setBpm,
    resetBpm: session.resetBpm,
    setClickEnabled: session.setClickEnabled,
    setClickAccent: session.setClickAccent,
    startingMeter: readMeter((selectedMeasure ?? measures?.[0])?.timeSignature) ?? DEFAULT_METER,
    startOptions,
    jumpRoute,
    playVisits: (first, last = first) => { void session.togglePlay(doc, { first, last }); },
    togglePlay: () => {
      void session.togglePlay(doc);
    },
    stop: () => session.stop(),
  };
}
