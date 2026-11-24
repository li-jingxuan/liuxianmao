import { DEFAULT_PLAYBACK_BPM, type ILXMDocument, type ILXMTimeSignature } from "@liuxianmao/lxm-editor";
import { createAudioContext, MetronomeClickAudio, resumeAudioContext } from "./metronome-audio";
import { DEFAULT_METER, isMetronomeBpm, meterLabel, practiceMeters, readMeter } from "./metronome-grid";

interface PracticeSettings {
  bpm: number;
  meter: ILXMTimeSignature;
}

export function readPracticeSource(document: ILXMDocument): PracticeSettings & { sourceLabel: string; detail: string } {
  const bpm = document.score.tempoBpm;
  const meter = readMeter(document.score.tracks[0]?.measures[0]?.timeSignature);
  const useScoreBpm = isMetronomeBpm(bpm);
  const supportedMeter = meter && practiceMeters.find((item) => meterLabel(item) === meterLabel(meter));
  const details: string[] = [];
  if (!useScoreBpm) details.push("曲谱没有有效速度，练习按 90 BPM。");
  if (!meter) details.push("谱首拍号缺失或无效，练习按 4/4。");
  else if (!supportedMeter) details.push(`曲谱为 ${meterLabel(meter)}，练习按 4/4。`);
  return {
    bpm: useScoreBpm ? bpm : DEFAULT_PLAYBACK_BPM,
    meter: supportedMeter || DEFAULT_METER,
    sourceLabel: useScoreBpm ? "曲谱设置" : "练习默认值",
    detail: details.join("") || "练习设置仅影响节拍器。",
  };
}

interface PracticeState {
  settings: PracticeSettings | null;
  phase: "stopped" | "starting" | "running";
  beat: number | null;
  mute: boolean;
  message: string;
}

const INITIAL_STATE: PracticeState = { settings: null, phase: "stopped", beat: null, mute: false, message: "" };
const SOUND_FAILURE = "声音不可用。可重试，或勾选「静音」后开始看拍点。";
const UNMUTE_FAILURE = "声音不可用，已保持静音。可继续看拍点，或再次尝试恢复声音。";
const LOOKAHEAD_MS = 90;

// 练习状态只属于当前文件会话，不参与谱面命令、历史或导出。用绝对起拍时间推算拍序，
// 静音、重音和收起只改变输出或界面，重复调度和浏览器卡顿不会逐拍累积误差。
export class PracticeMetronome {
  private state = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private clicks = new MetronomeClickAudio();
  private context: AudioContext | null = null;
  private pending: AbortController | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private anchor = 0;
  private interval = 0;
  private nextClick = 0;
  private accent = true;
  private resumingSound = false;

  constructor(private readonly createContext = createAudioContext, private readonly now = () => performance.now()) {}

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(change: Partial<PracticeState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }

  initialize(source: PracticeSettings) {
    if (!this.state.settings) this.update({ settings: { bpm: source.bpm, meter: source.meter } });
  }

  setSettings(settings: PracticeSettings) {
    if (this.state.phase === "stopped") this.update({ settings });
  }

  start = async () => {
    const { settings, phase, mute } = this.state;
    if (!settings || phase !== "stopped") return;
    this.update({ phase: "starting", message: "" });
    if (!mute) {
      const request = this.pending = new AbortController();
      try {
        await this.unlock(request.signal);
        request.signal.throwIfAborted();
      } catch {
        if (!request.signal.aborted) this.stopWithError(SOUND_FAILURE);
        return;
      }
      this.pending = null;
    }
    this.interval = 60_000 / settings.bpm * 4 / settings.meter.denominator;
    this.anchor = this.now() + (mute ? 0 : 25);
    this.nextClick = 0;
    this.update({ phase: "running" });
    this.timer = setInterval(this.pump, 20);
    this.pump();
  };

  stop = () => {
    this.closeAudio();
    clearInterval(this.timer);
    if (this.state.phase !== "stopped" || this.state.message)
      this.update({ phase: "stopped", beat: null, message: "" });
  };

  reset() {
    this.stop();
    this.accent = true;
    if (this.state !== INITIAL_STATE) this.update(INITIAL_STATE);
  }

  setAccent(accent: boolean) {
    this.accent = accent;
    const { context } = this;
    if (this.state.phase !== "running" || !context) return;
    const now = this.now();
    this.clicks.cancel(context.currentTime + (now < this.anchor ? 0 : 0.000001));
    this.nextClick = this.firstFutureClick(now);
    this.pump();
  }

  setMute = async (mute: boolean) => {
    if (this.state.phase === "starting") return;
    if (mute) {
      this.closeAudio();
      this.update({ mute: true, message: "" });
      return;
    }
    if (!this.state.mute) return;
    if (this.state.phase === "stopped") {
      this.update({ mute: false, message: "" });
      return;
    }
    if (this.pending || this.resumingSound) return;

    // 解锁在点击事件中发起。直到下一拍的音频节点成功排程才解除静音，失败时保留计拍与拍序。
    const request = this.pending = new AbortController();
    this.update({ message: "" });
    try {
      await this.unlock(request.signal);
      request.signal.throwIfAborted();
      this.pending = null;
      this.resumingSound = true;
      this.nextClick = this.firstFutureClick(this.now());
      this.pump();
    } catch {
      if (!request.signal.aborted) this.keepMuted();
    }
  };

  private async unlock(signal: AbortSignal) {
    const context = this.context = this.createContext();
    context.onstatechange = () => {
      if (this.context !== context || context.state === "running" || this.state.phase !== "running") return;
      if (this.state.mute && (this.pending || this.resumingSound)) this.keepMuted();
      else if (!this.state.mute) this.stopWithError(SOUND_FAILURE);
    };
    await resumeAudioContext(context, signal);
  }

  private closeAudio() {
    this.pending?.abort();
    this.pending = null;
    this.resumingSound = false;
    this.clicks.cancel();
    const context = this.context;
    this.context = null;
    if (!context) return;
    context.onstatechange = null;
    if (context.state !== "closed") void context.close().catch(() => undefined);
  }

  private keepMuted() {
    this.closeAudio();
    this.update({ mute: true, message: UNMUTE_FAILURE });
  }

  private stopWithError(message: string) {
    this.stop();
    this.update({ message });
  }

  private firstFutureClick(now: number) {
    return Math.max(0, Math.floor((now - this.anchor) / this.interval) + 1);
  }

  private pump = () => {
    const { context, state, interval, anchor } = this;
    if (state.phase !== "running" || !state.settings) return;
    const now = this.now();
    const count = state.settings.meter.numerator;
    const elapsed = Math.floor((now - anchor) / interval);
    const beat = elapsed < 0 ? null : elapsed % count + 1;
    if (state.beat !== beat) this.update({ beat });
    if (!context || (state.mute && !this.resumingSound)) return;
    if (context.state !== "running") {
      if (this.resumingSound) this.keepMuted();
      else this.stopWithError(SOUND_FAILURE);
      return;
    }

    try {
      this.nextClick = Math.max(this.nextClick, Math.ceil((now - anchor - 25) / interval));
      const audioTime = context.currentTime;
      while (anchor + this.nextClick * interval <= now + LOOKAHEAD_MS) {
        const when = audioTime + Math.max(0, anchor + this.nextClick * interval - now) / 1000;
        this.clicks.schedule(context, when, this.accent && this.nextClick % count === 0);
        this.nextClick++;
        if (this.resumingSound) {
          this.resumingSound = false;
          this.update({ mute: false, message: "" });
        }
      }
    } catch {
      if (this.resumingSound) this.keepMuted();
      else this.stopWithError(SOUND_FAILURE);
    }
  };
}
