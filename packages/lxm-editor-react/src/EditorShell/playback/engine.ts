import {
  playbackSecondsToTicks,
  playbackTicksToSeconds,
  type PlaybackEnvelope,
  type PlaybackPlan,
  type PlaybackSound,
} from "@liuxianmao/lxm-editor";
import {
  GuitarSampleBank,
  guitarSampleKey,
  type DecodedGuitarSample,
} from "./samples";
import { createAudioContext, MetronomeClickAudio, resumeAudioContext } from "./metronome-audio";
import type { ScoreMetronomeBeat, ScoreMetronomeGrid } from "./metronome-grid";

const SCHEDULE_INTERVAL_MS = 25;
const LOOKAHEAD_SECONDS = 0.12;
const MIN_CLICK_SPACING_SECONDS = 0.01;
const START_LEAD_SECONDS = 0.025;
const STOP_FADE_SECONDS = 0.008;
const RESUME_FADE_SECONDS = 0.008;
const PREPARE_TIMEOUT_MS = 20_000;
const MASTER_GAIN = 1;

interface PitchSpan {
  start: number;
  end: number;
  from: number;
  to: number;
}

function pitchSpans(
  sound: PlaybackSound,
  duration: number,
  seconds: (ticks: number) => number,
): PitchSpan[] {
  const base: PitchSpan[] = [];
  let start = 0;
  let from = 0;
  for (const point of sound.pitch) {
    const at = seconds(point.offsetTicks);
    const end = Math.min(at, duration);
    if (end > start) {
      const to =
        point.interpolation === "linear"
          ? from + (point.semitones - from) * ((end - start) / (at - start))
          : from;
      base.push({ start, end, from, to });
    }
    if (at >= duration) break;
    start = at;
    from = point.semitones;
  }
  if ((base.at(-1)?.end ?? 0) < duration)
    base.push({ start, end: duration, from, to: from });
  if (!sound.vibrato.length) return base;

  const windows = sound.vibrato.map((effect) => ({
    ...effect,
    start: seconds(effect.startOffsetTicks),
    end: seconds(effect.endOffsetTicks),
  }));
  const result: PitchSpan[] = [];
  for (const span of base) {
    const active = windows.filter(
      (window) => window.start < span.end && window.end > span.start,
    );
    if (!active.length) {
      result.push(span);
      continue;
    }
    const boundaries = new Set([span.start, span.end]);
    for (const window of active) {
      boundaries.add(Math.max(span.start, window.start));
      boundaries.add(Math.min(span.end, window.end));
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    const valueAt = (time: number) => {
      let value = pitchAt(span, time);
      for (const window of active) {
        const elapsed = time - window.start;
        const fade = Math.max(
          0,
          Math.min(1, elapsed / 0.02, (window.end - time) / 0.02),
        );
        value +=
          window.depthSemitones *
          fade *
          Math.sin(elapsed * window.frequencyHz * 2 * Math.PI);
      }
      return value;
    };
    for (let index = 1; index < ordered.length; index++) {
      const left = ordered[index - 1]!;
      const right = ordered[index]!;
      const hasVibrato = active.some(
        (window) => window.start < right && window.end > left,
      );
      const pieces = hasVibrato ? Math.ceil((right - left) * 120) : 1;
      for (let piece = 0; piece < pieces; piece++) {
        const start = left + ((right - left) * piece) / pieces;
        const end =
          piece === pieces - 1
            ? right
            : left + ((right - left) * (piece + 1)) / pieces;
        result.push({ start, end, from: valueAt(start), to: valueAt(end) });
      }
    }
  }
  return result;
}

function pitchAt(span: PitchSpan, time: number): number {
  return (
    span.from +
    (span.to - span.from) * ((time - span.start) / (span.end - span.start))
  );
}

function sampleProgress(
  spans: readonly PitchSpan[],
  elapsed: number,
  transpose: number,
): number {
  let consumed = 0;
  for (const span of spans) {
    if (span.start >= elapsed) break;
    const end = Math.min(span.end, elapsed);
    const startRate = 2 ** ((transpose + span.from) / 12);
    // A ramp that is linear in cents has an exponential playback rate.
    const change = ((pitchAt(span, end) - span.from) * Math.LN2) / 12;
    const average = Math.abs(change) < 1e-8 ? 1 : Math.expm1(change) / change;
    consumed += (end - span.start) * startRate * average;
  }
  return consumed;
}

function schedulePitch(
  param: AudioParam,
  spans: readonly PitchSpan[],
  elapsed: number,
  when: number,
  transpose: number,
): void {
  for (const span of spans) {
    if (span.end <= elapsed) continue;
    const start = Math.max(elapsed, span.start);
    const from = pitchAt(span, start);
    param.setValueAtTime((transpose + from) * 100, when + (start - elapsed));
    if (span.to !== from)
      param.linearRampToValueAtTime(
        (transpose + span.to) * 100,
        when + (span.end - elapsed),
      );
  }
}

interface EnvelopeSegment {
  start: number;
  initialGain: number;
  attack: number;
  envelope: PlaybackEnvelope;
}

function baseGain(segment: EnvelopeSegment, time: number): number {
  const { start, attack, envelope, initialGain } = segment;
  const elapsed = Math.max(0, time - start);
  if (elapsed < attack)
    return initialGain + (envelope.gain - initialGain) * (elapsed / attack);
  return envelope.decaySeconds
    ? envelope.gain * Math.exp(-(elapsed - attack) / envelope.decaySeconds)
    : envelope.gain;
}

function envelopeSegments(
  sound: PlaybackSound,
  duration: number,
  seconds: (ticks: number) => number,
): EnvelopeSegment[] {
  const changes = sound.envelopeChanges
    .map((change) => ({
      start: seconds(change.offsetTicks),
      envelope: change.envelope,
    }))
    .filter(({ start }) => start < duration)
    .sort((a, b) => a.start - b.start);
  const segments: EnvelopeSegment[] = [];
  for (const { start, envelope } of [
    { start: 0, envelope: sound.envelope },
    ...changes,
  ]) {
    const previous = segments.at(-1);
    const initialGain = previous ? baseGain(previous, start) : 0;
    segments.push({
      start,
      envelope,
      initialGain,
      attack: Math.min(envelope.attackSeconds, (duration - start) / 2),
    });
  }
  return segments;
}

function scheduleGain(
  param: AudioParam,
  segments: readonly EnvelopeSegment[],
  elapsed: number,
  duration: number,
  when: number,
): void {
  const release = Math.min(
    segments.at(-1)!.envelope.releaseSeconds,
    duration / 2,
  );
  const releaseStart = duration - release;
  const resumeFade =
    elapsed > 0 ? Math.min(RESUME_FADE_SECONDS, duration - elapsed) : 0;
  const timeFor = (time: number) => when + (time - elapsed);
  param.setValueAtTime(0, when);
  for (const [index, segment] of segments.entries()) {
    const end = segments[index + 1]?.start ?? duration;
    const start = Math.max(segment.start, elapsed);
    if (end <= start) continue;

    const attackEnd = segment.start + segment.attack;
    const stops = new Set([start, end]);
    for (const boundary of [attackEnd, elapsed + resumeFade, releaseStart]) {
      if (boundary > start && boundary < end) stops.add(boundary);
    }
    const decay = segment.envelope.decaySeconds;
    if (decay) {
      for (let step = 1; step <= 24; step++) {
        const time = attackEnd + (decay * step) / 3;
        if (time > start && time < end) stops.add(time);
      }
    }

    for (const time of [...stops].sort((a, b) => a - b)) {
      const fadeIn = resumeFade
        ? Math.min(1, (time - elapsed) / resumeFade)
        : 1;
      const fadeOut =
        release && time >= releaseStart ? (duration - time) / release : 1;
      const gain =
        time === duration ? 0 : baseGain(segment, time) * fadeIn * fadeOut;
      if (time === start) param.setValueAtTime(gain, timeFor(time));
      else param.linearRampToValueAtTime(gain, timeFor(time));
    }
  }
}

function addFilter(
  context: AudioContext,
  input: AudioNode,
  type: "lowpass" | "highpass",
  segments: readonly EnvelopeSegment[],
  elapsed: number,
  when: number,
  nodes: AudioNode[],
): AudioNode {
  const key = type === "lowpass" ? "lowpassHz" : "highpassHz";
  if (!segments.some(({ envelope }) => envelope[key] != null)) return input;
  const filter = context.createBiquadFilter();
  nodes.push(filter);
  filter.type = type;
  filter.Q.value = -3;
  const neutral = type === "lowpass" ? context.sampleRate / 2 : 10;
  let cutoff = neutral;
  for (const { start, envelope } of segments) {
    if (start <= elapsed) cutoff = envelope[key] ?? neutral;
    else
      filter.frequency.setTargetAtTime(
        envelope[key] ?? neutral,
        when + (start - elapsed),
        0.005,
      );
  }
  filter.frequency.setValueAtTime(cutoff, when);
  input.connect(filter);
  return filter;
}

interface Voice {
  source: AudioBufferSourceNode;
  when: number;
  end: number;
  disconnect: () => void;
}

interface Run {
  anchor: number;
  offset: number;
  bpm: number;
  duration: number;
  sounds: readonly PlaybackSound[];
  samples: ReadonlyMap<string, DecodedGuitarSample>;
  next: number;
  gate: GainNode;
  voices: Set<Voice>;
  click?: MetronomeRunOptions & { next: ScoreMetronomeBeat | null; failed: boolean };
  timer?: ReturnType<typeof setInterval>;
}

interface MetronomeRunOptions {
  grid: ScoreMetronomeGrid;
  enabled: boolean;
  accent: boolean;
  skipOnset: boolean;
}

import type { BundledGuitarSamples } from "../../resources/bundled-assets";

export class ScoreAudioEngine {
  onInterrupted?: () => void;
  onClickFailed?: () => void;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private peakCompressor: DynamicsCompressorNode | null = null;
  private bank: GuitarSampleBank | null = null;
  private preparing: AbortController | null = null;
  private prepared: {
    plan: PlaybackPlan;
    samples: ReadonlyMap<string, DecodedGuitarSample>;
  } | null = null;
  private run: Run | null = null;
  private frozenTick = 0;
  private disposed = false;
  private clicks = new MetronomeClickAudio();

  constructor(private readonly createContext = createAudioContext, private readonly audioDirectory?: string,
    private readonly bundled?: BundledGuitarSamples) {}

  async unlock(signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new Error("试听已退出");
    if (this.context?.state === "closed") {
      this.stop();
      this.context.onstatechange = null;
      this.master?.disconnect();
      this.peakCompressor?.disconnect();
      this.context = null;
      this.prepared = null;
    }
    const context = this.context ?? this.initializeContext();
    await resumeAudioContext(context, signal);
  }

  async prepare(plan: PlaybackPlan, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const bank = this.bank;
    if (!bank) throw new Error("音频尚未启动");
    this.preparing?.abort();
    if (this.prepared?.plan === plan) return;
    const request = new AbortController();
    this.preparing = request;
    const abort = () => request.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => request.abort(new Error("木吉他音源加载超时，请重试")),
      PREPARE_TIMEOUT_MS,
    );
    const aborted = new Promise<never>((_, reject) => {
      request.signal.addEventListener(
        "abort",
        () => reject(request.signal.reason),
        { once: true },
      );
    });
    try {
      const samples = await Promise.race([
        bank.load(plan.sounds, request.signal),
        aborted,
      ]);
      request.signal.throwIfAborted();
      this.prepared = { plan, samples };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      request.abort();
      if (this.preparing === request) this.preparing = null;
    }
  }

  /** 木吉他静音不影响共享音频时钟或独立的节拍点击。 */
  setGuitarMuted(muted: boolean) {
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.context.currentTime, 0.012);
  }

  start(plan: PlaybackPlan, bpm: number, offsetTick: number, metronome?: MetronomeRunOptions): void {
    this.startRun(plan, bpm, offsetTick, metronome, START_LEAD_SECONDS);
  }

  // 用当前音频刻度重建已排程的吉他声部和点击，保持访问顺序、游标及小节内相位。
  // 已解码音源可复用；若原来的起播时刻尚未抵达，仍留出正常起播的排程余量。
  changeTempo(plan: PlaybackPlan, bpm: number) {
    const run = this.run;
    if (!run) return;
    const started = this.hasStarted();
    const offset = this.currentTick();
    const click = run.click && { ...run.click, skipOnset: started || run.click.skipOnset };
    this.startRun(plan, bpm, offset, click, started ? 0 : START_LEAD_SECONDS, run.click?.failed);
  }

  private startRun(plan: PlaybackPlan, bpm: number, offsetTick: number, metronome: MetronomeRunOptions | undefined,
    lead: number, clickFailed = false): void {
    const { context, master, prepared } = this;
    if (!context || !master || context.state !== "running")
      throw new Error("音频尚未启动");
    if (prepared?.plan !== plan) throw new Error("木吉他音源尚未准备好");
    if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(offsetTick))
      throw new Error("试听速度或起点无效");
    this.stop();

    const offset = Math.max(0, Math.min(offsetTick, plan.durationTicks));
    const gate = context.createGain();
    gate.connect(master);
    const run: Run = {
      anchor: context.currentTime + lead,
      offset,
      bpm,
      duration: plan.durationTicks,
      sounds: plan.sounds
        .filter((sound) => sound.endTick > offset)
        .sort((a, b) => a.startTick - b.startTick),
      samples: prepared.samples,
      next: 0,
      gate,
      voices: new Set(),
      click: metronome && {
        ...metronome,
        next: metronome.enabled ? metronome.grid.nextBeat(offset, !metronome.skipOnset) : null,
        failed: clickFailed,
      },
    };
    this.run = run;
    this.frozenTick = offset;
    try {
      this.pump(context, run);
      if (this.run === run)
        run.timer = setInterval(() => {
          if (this.run !== run) return;
          try {
            this.pump(context, run);
          } catch {
            this.interrupt();
          }
        }, SCHEDULE_INTERVAL_MS);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  hasStarted(): boolean {
    return !!this.run && !!this.context && this.context.currentTime >= this.run.anchor;
  }

  setClickEnabled(enabled: boolean): number {
    const { run, context } = this;
    if (!run?.click || !context) return Infinity;
    this.clicks.cancel();
    run.click.enabled = enabled;
    run.click.failed = false;
    run.click.next = enabled ? run.click.grid.nextBeat(this.currentTick(), !this.hasStarted() && !run.click.skipOnset) : null;
    const nextTick = run.click.next?.tick ?? Infinity;
    if (enabled) this.pumpClick(context, run);
    return nextTick;
  }

  setClickAccent(accent: boolean): void {
    const { run, context } = this;
    if (!run?.click || !context || run.click.accent === accent) return;
    run.click.accent = accent;
    if (!run.click.enabled || run.click.failed) return;
    const started = this.hasStarted();
    this.clicks.cancel(context.currentTime + (started ? 0.000001 : 0));
    run.click.next = run.click.grid.nextBeat(this.currentTick(), !started && !run.click.skipOnset);
    this.pumpClick(context, run);
  }

  currentTick(): number {
    if (!this.run || !this.context) return this.frozenTick;
    const { anchor, offset, bpm, duration } = this.run;
    return Math.min(
      duration,
      offset +
        playbackSecondsToTicks(
          Math.max(0, this.context.currentTime - anchor),
          bpm,
        ),
    );
  }

  stop(): void {
    this.preparing?.abort();
    this.clicks.cancel();
    const { context, run } = this;
    if (!context || !run) return;
    this.frozenTick = this.currentTick();
    this.run = null;
    clearInterval(run.timer);

    const now = context.currentTime;
    const fade = context.state === "running" && !this.disposed;
    const stopAt = fade ? now + STOP_FADE_SECONDS : now;
    if (fade) {
      run.gate.gain.setValueAtTime(1, now);
      run.gate.gain.linearRampToValueAtTime(0, stopAt);
    }
    for (const voice of run.voices) {
      const active = fade && voice.when <= now;
      voice.source.stop(active ? Math.min(voice.end, stopAt) : now);
      if (!active) voice.disconnect();
    }
    if (!run.voices.size) run.gate.disconnect();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    const context = this.context;
    this.context = null;
    this.master?.disconnect();
    this.master = null;
    this.peakCompressor?.disconnect();
    this.peakCompressor = null;
    this.prepared = null;
    this.bank = null;
    this.onInterrupted = undefined;
    this.onClickFailed = undefined;
    if (context) {
      context.onstatechange = null;
      if (context.state !== "closed")
        void context.close().catch(() => undefined);
    }
  }

  private initializeContext(): AudioContext {
    const context = this.createContext();
    this.context = context;
    const master = context.createGain();
    master.gain.value = MASTER_GAIN;
    const compressor = context.createDynamicsCompressor();
    // Preserve the published sample levels and soften peaks where several strings overlap.
    compressor.threshold.value = -6;
    compressor.knee.value = 4;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(context.destination);
    this.master = master;
    this.peakCompressor = compressor;
    this.bank = new GuitarSampleBank(context, undefined, undefined, this.audioDirectory, this.bundled);
    context.onstatechange = () => {
      if (context.state !== "running" && this.run) this.interrupt();
    };
    return context;
  }

  private interrupt(): void {
    const finished = this.run && this.currentTick() >= this.run.duration;
    this.stop();
    if (!finished) this.onInterrupted?.();
  }

  private pump(context: AudioContext, run: Run): void {
    if (context.state !== "running") {
      this.interrupt();
      return;
    }
    const now = context.currentTime;
    const tick = this.currentTick();
    if (tick >= run.duration) {
      this.stop();
      return;
    }

    const seconds = (ticks: number) => playbackTicksToSeconds(ticks, run.bpm);
    const horizon = now + LOOKAHEAD_SECONDS;
    for (; run.next < run.sounds.length; run.next++) {
      const sound = run.sounds[run.next]!;
      const start = Math.max(run.offset, sound.startTick);
      const when = Math.max(now, run.anchor + seconds(start - run.offset));
      if (when > horizon) break;
      const end = run.anchor + seconds(sound.endTick - run.offset);
      if (end <= when) continue;
      const elapsed =
        seconds(start - sound.sourceStartTick) +
        Math.max(0, now - (run.anchor + seconds(start - run.offset)));
      this.playSound(context, run, sound, seconds, elapsed, when, end);
    }
    this.pumpClick(context, run);
  }

  private pumpClick(context: AudioContext, run: Run): void {
    const click = run.click;
    if (!click?.enabled || click.failed || !click.next) return;
    const now = context.currentTime;
    if (context.state !== "running") return;
    try {
      // 后台调度若落后，直接跳过过时的拍点，避免恢复时积压的声音一起响。
      const minimumTick = run.offset + playbackSecondsToTicks(now - run.anchor - 0.025, run.bpm);
      if (click.next.tick < minimumTick) click.next = click.grid.nextBeat(minimumTick, true);
      while (click.next) {
        const beat = click.next;
        const when = run.anchor + playbackTicksToSeconds(beat.tick - run.offset, run.bpm);
        if (when > now + LOOKAHEAD_SECONDS) break;
        this.clicks.schedule(context, Math.max(now, when), click.accent && beat.number === 1);
        // 极密的导入拍号仍保留其可视拍序，但不向 Web Audio 同时提交大量听感无法区分的点击节点。
        const next = click.grid.nextBeat(beat.tick, false);
        const minimumNext = beat.tick + playbackSecondsToTicks(MIN_CLICK_SPACING_SECONDS, run.bpm);
        click.next = next && next.tick < minimumNext ? click.grid.nextBeat(minimumNext, true) : next;
      }
    } catch {
      // 点击声节点出错时只熄灭点击音轨，吉他、播放时钟及可视拍点继续运行。
      click.failed = true;
      this.clicks.cancel();
      this.onClickFailed?.();
    }
  }

  private playSound(
    context: AudioContext,
    run: Run,
    sound: PlaybackSound,
    seconds: (ticks: number) => number,
    elapsed: number,
    when: number,
    end: number,
  ): void {
    const sample = run.samples.get(guitarSampleKey(sound));
    if (!sample) throw new Error("木吉他音源未准备好");
    const transpose = sound.midi - sample.midi;
    const duration = seconds(sound.endTick - sound.sourceStartTick);
    const pitch = pitchSpans(sound, duration, seconds);
    const offset =
      sound.envelope.sampleOffsetSeconds +
      sampleProgress(pitch, elapsed, transpose);
    if (offset >= sample.buffer.duration) return;

    const segments = envelopeSegments(sound, duration, seconds);
    const source = context.createBufferSource();
    const nodes: AudioNode[] = [source];
    const voice: Voice = {
      source,
      when,
      end,
      disconnect: () => {
        source.onended = null;
        for (const node of nodes) node.disconnect();
        run.voices.delete(voice);
        if (this.run !== run && !run.voices.size) run.gate.disconnect();
      },
    };
    try {
      source.buffer = sample.buffer;
      schedulePitch(source.detune, pitch, elapsed, when, transpose);
      const gain = context.createGain();
      nodes.push(gain);
      scheduleGain(gain.gain, segments, elapsed, duration, when);
      const darkened = addFilter(
        context,
        source,
        "lowpass",
        segments,
        elapsed,
        when,
        nodes,
      );
      const filtered = addFilter(
        context,
        darkened,
        "highpass",
        segments,
        elapsed,
        when,
        nodes,
      );
      filtered.connect(gain);
      gain.connect(run.gate);
      source.onended = voice.disconnect;
      source.start(when, offset);
      run.voices.add(voice);
      source.stop(end);
    } catch (error) {
      if (!run.voices.has(voice)) voice.disconnect();
      throw error;
    }
  }
}
