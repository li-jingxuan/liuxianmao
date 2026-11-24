import type {
  PlaybackEnvelope,
  PlaybackPlan,
  PlaybackSound,
} from "@liuxianmao/lxm-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScoreAudioEngine } from "../../../packages/lxm-editor-react/src/EditorShell/playback/engine";
import { createScoreMetronomeGrid } from "../../../packages/lxm-editor-react/src/EditorShell/playback/metronome-grid";
import { PracticeMetronome } from "../../../packages/lxm-editor-react/src/EditorShell/playback/practice-metronome";
import {
  GuitarSampleBank,
  guitarSampleKey,
} from "../../../packages/lxm-editor-react/src/EditorShell/playback/samples";

const envelope: PlaybackEnvelope = {
  gain: 0.85,
  attackSeconds: 0.003,
  sampleOffsetSeconds: 0,
  releaseSeconds: 0.024,
  lowpassHz: null,
  highpassHz: null,
  decaySeconds: null,
};

const note = (overrides: Partial<PlaybackSound> = {}): PlaybackSound => ({
  visitIndex: 0,
  measureId: "measure",
  beatId: "beat",
  noteId: "note",
  string: 1,
  midi: 64,
  targetMidi: 64,
  startTick: 0,
  endTick: 960,
  sourceStartTick: 0,
  onsetOffsetTicks: 0,
  attack: "pluck",
  pickStroke: null,
  techniques: [],
  pitch: [],
  vibrato: [],
  envelope,
  envelopeChanges: [],
  ...overrides,
});

const plan = (...sounds: PlaybackSound[]): PlaybackPlan => ({
  bpm: 120,
  durationTicks: 1920,
  sounds,
  visits: [],
  beats: [],
  warnings: [],
});

const param = () => ({
  value: 1,
  setValueAtTime: vi.fn<(value: number, time: number) => void>(),
  linearRampToValueAtTime: vi.fn<(value: number, time: number) => void>(),
  exponentialRampToValueAtTime: vi.fn<(value: number, time: number) => void>(),
  setTargetAtTime:
    vi.fn<(value: number, time: number, timeConstant: number) => void>(),
});
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const gain = () => ({ ...node(), gain: param() });
const compressor = () => ({
  ...node(),
  threshold: param(),
  knee: param(),
  ratio: param(),
  attack: param(),
  release: param(),
});
const filter = () => ({ ...node(), frequency: param(), Q: param(), type: "" });
const source = () => ({
  ...node(),
  detune: param(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null,
});

function audioContext(sampleLength = 2) {
  const decoded = {
    duration: sampleLength,
    length: 48_000 * sampleLength,
    numberOfChannels: 1,
  } as AudioBuffer;
  const context = {
    state: "suspended",
    currentTime: 0,
    sampleRate: 48_000,
    destination: node(),
    onstatechange: null as (() => void) | null,
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    decodeAudioData: vi.fn<(bytes: ArrayBuffer) => Promise<AudioBuffer>>(
      async () => decoded,
    ),
    createBiquadFilter: vi.fn(filter),
    createBufferSource: vi.fn(source),
    createOscillator: vi.fn(() => ({ ...source(), frequency: param(), type: "" })),
    createDynamicsCompressor: vi.fn(compressor),
    createGain: vi.fn(gain),
  };
  return { context, decoded, webAudio: context as unknown as AudioContext };
}

const officialFile = (string: string, layer: number, pitch: string) =>
  `INSGuitarSteel_String${string}_Vel0${layer}_${pitch}_01.wav`;
const fixture = [
  ...[1, 2, 3].map((layer) => officialFile("HighE", layer, "E4")),
  officialFile("A", 2, "B2"),
  officialFile("LowE", 2, "As2"),
  officialFile("B", 2, "B3"),
  officialFile("G", 2, "G3"),
  officialFile("D", 2, "D3"),
  officialFile("A", 2, "A2"),
  officialFile("LowE", 2, "E2"),
];
const manifest = () =>
  Response.json({ samples: fixture.map((file) => ({ file })) });
const fetchAudio = vi.fn<typeof fetch>((url) =>
  Promise.resolve(
    String(url).endsWith("manifest.json")
      ? manifest()
      : new Response(new Uint8Array([1])),
  ),
);

afterEach(() => {
  fetchAudio.mockClear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("steel guitar samples", () => {
  it("uses the global browser receiver for the default native fetch", async () => {
    const { webAudio } = audioContext();
    vi.stubGlobal(
      "fetch",
      function (this: typeof globalThis, ...args: Parameters<typeof fetch>) {
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        return fetchAudio(...args);
      },
    );
    const bank = new GuitarSampleBank(webAudio);
    await expect(
      bank.load([note()], new AbortController().signal),
    ).resolves.toHaveProperty("size", 1);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });

  it("selects same-string pitches by MIDI and velocity, deduplicates requests, and reuses decoded samples", async () => {
    const { webAudio } = audioContext();
    const bank = new GuitarSampleBank(webAudio, fetchAudio, "/music");
    const regular = note();
    const down = note({ pickStroke: "down" });
    const muted = note({
      pickStroke: "down",
      envelope: { ...envelope, decaySeconds: 0.09 },
    });
    const harmonic = note({ envelope: { ...envelope, highpassHz: 380 } });
    const legato = (["hammerOn", "pullOff", "tapping"] as const).map((attack) =>
      note({ attack }),
    );
    const missingPitch = note({ string: 6, midi: 47 });
    const exactOtherString = note({ string: 5, midi: 47 });
    const sounds = [
      regular,
      note({ pickStroke: "up" }),
      down,
      muted,
      harmonic,
      ...legato,
      missingPitch,
      exactOtherString,
    ];
    const controller = new AbortController();
    const loaded = await bank.load(sounds, controller.signal);

    expect([...loaded.keys()].sort()).toEqual([
      "1:64:1",
      "1:64:2",
      "1:64:3",
      "5:47:2",
      "6:47:2",
    ]);
    expect(loaded.get(guitarSampleKey(missingPitch))?.midi).toBe(46);
    expect(loaded.get(guitarSampleKey(exactOtherString))?.midi).toBe(47);
    expect(fetchAudio.mock.calls.map(([url]) => url)).toEqual([
      "/music/assets/audio/meta-steel-guitar-v1/manifest.json",
      "/music/assets/audio/meta-steel-guitar-v1/ogg/INSGuitarSteel_StringHighE_Vel02_E4_01.ogg",
      "/music/assets/audio/meta-steel-guitar-v1/ogg/INSGuitarSteel_StringHighE_Vel03_E4_01.ogg",
      "/music/assets/audio/meta-steel-guitar-v1/ogg/INSGuitarSteel_StringHighE_Vel01_E4_01.ogg",
      "/music/assets/audio/meta-steel-guitar-v1/ogg/INSGuitarSteel_StringLowE_Vel02_As2_01.ogg",
      "/music/assets/audio/meta-steel-guitar-v1/ogg/INSGuitarSteel_StringA_Vel02_B2_01.ogg",
    ]);
    expect(await bank.load(sounds, controller.signal)).toEqual(loaded);
    expect(fetchAudio).toHaveBeenCalledTimes(6);
  });

  it("falls back to the site-hosted AAC sample if Ogg decoding fails", async () => {
    const { context, decoded, webAudio } = audioContext();
    context.decodeAudioData.mockRejectedValueOnce(
      new Error("unsupported codec"),
    );
    const bank = new GuitarSampleBank(webAudio, fetchAudio);
    const signal = new AbortController().signal;
    const sound = note({ attack: "tapping" });
    const result = await bank.load([sound], signal);
    expect(result.get(guitarSampleKey(sound))?.buffer).toBe(decoded);
    await bank.load([note()], signal);
    expect(
      fetchAudio.mock.calls
        .slice(1)
        .map(([url]) => String(url).split("/").slice(-2).join("/")),
    ).toEqual([
      "ogg/INSGuitarSteel_StringHighE_Vel01_E4_01.ogg",
      "m4a/INSGuitarSteel_StringHighE_Vel01_E4_01.m4a",
      "m4a/INSGuitarSteel_StringHighE_Vel02_E4_01.m4a",
    ]);
  });
});

describe("Web Audio playback", () => {
  it("anchors audition clicks to the guitar clock and isolates click failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAudio);
    const { context, webAudio } = audioContext();
    const engine = new ScoreAudioEngine(() => webAudio);
    const score = plan(note({ endTick: 1920 }));
    score.visits = [{ measureId: "measure", measureIndex: 0, visitIndex: 0, startTick: 0, endTick: 1920, jumped: false }];
    const grid = createScoreMetronomeGrid(score, [{ timeSignature: { numerator: 4, denominator: 8 } }]);
    const fail = engine.onClickFailed = vi.fn();
    await engine.unlock();
    await engine.prepare(score, new AbortController().signal);
    engine.start(score, 120, 0, { grid, enabled: true, accent: true, skipOnset: false });
    const first = context.createOscillator.mock.results[0]!.value;
    expect(first.start).toHaveBeenCalledWith(0.025);
    expect(first.frequency.value).toBe(1300);
    expect(context.createBufferSource.mock.results[0]!.value.start).toHaveBeenCalledWith(0.025, 0);
    expect(engine.hasStarted()).toBe(false);

    context.currentTime = 0.16;
    vi.advanceTimersByTime(25);
    const second = context.createOscillator.mock.results[1]!.value;
    expect(second.start).toHaveBeenCalledWith(0.275);
    expect(second.frequency.value).toBe(920);
    engine.setClickEnabled(false);
    expect(second.disconnect).toHaveBeenCalledOnce();
    expect(context.createBufferSource.mock.results[0]!.value.stop).toHaveBeenCalledTimes(1);

    const tick = engine.currentTick();
    engine.changeTempo(score, 60);
    expect(engine.currentTick()).toBeCloseTo(tick);
    expect(engine.setClickEnabled(true)).toBe(480);
    context.currentTime = 0.32;
    context.createOscillator.mockImplementationOnce(() => { throw new Error("click unavailable"); });
    vi.advanceTimersByTime(25);
    expect(fail).toHaveBeenCalledOnce();
    const failedTick = engine.currentTick();
    context.currentTime = 0.42;
    expect(engine.currentTick()).toBeGreaterThan(failedTick);
    engine.dispose();
  });

  it("unlocks on the gesture, advances the lookahead against the audio clock, and cancels queued voices", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAudio);
    const { context, webAudio } = audioContext();
    const createContext = vi.fn(() => webAudio);
    const engine = new ScoreAudioEngine(createContext);
    const score = plan(
      note(),
      note({ startTick: 240, endTick: 720, sourceStartTick: 240 }),
    );
    expect(createContext).not.toHaveBeenCalled();
    const unlocked = engine.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    await unlocked;
    await engine.prepare(score, new AbortController().signal);
    engine.start(score, score.bpm, 0);

    const first = context.createBufferSource.mock.results[0]!.value;
    expect(first.start).toHaveBeenCalledWith(0.025, 0);
    expect(first.stop).toHaveBeenCalledWith(0.525);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    context.currentTime = 0.05;
    vi.advanceTimersByTime(25);
    const queued = context.createBufferSource.mock.results[1]!.value;
    expect(queued.start).toHaveBeenCalledWith(0.15, 0);
    context.currentTime = 0.08;
    const tick = engine.currentTick();
    engine.stop();
    expect(first.stop.mock.lastCall![0]).toBeCloseTo(0.088);
    expect(queued.stop.mock.lastCall).toEqual([0.08]);
    expect(queued.disconnect).toHaveBeenCalledOnce();
    const gate = context.createGain.mock.results[1]!.value;
    expect(gate.gain.linearRampToValueAtTime.mock.lastCall![0]).toBe(0);
    context.currentTime = 0.1;
    vi.advanceTimersByTime(100);
    expect(engine.currentTick()).toBe(tick);
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);

    await engine.prepare(score, new AbortController().signal);
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    engine.start(score, score.bpm, tick);
    const resumed = context.createBufferSource.mock.results[2]!.value;
    expect(resumed.start.mock.lastCall![0]).toBeCloseTo(0.125);
    expect(resumed.start.mock.lastCall![1]).toBeCloseTo(0.055);
    engine.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues a carried slide and trill with pitch-correct sample progress, vibrato, filters, and damping", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAudio);
    const { context, webAudio } = audioContext();
    const engine = new ScoreAudioEngine(() => webAudio);
    const score = plan(
      note({
        string: 6,
        midi: 47,
        sourceStartTick: -288,
        targetMidi: 52,
        envelope: { ...envelope, lowpassHz: 6200, sampleOffsetSeconds: 0.02 },
        envelopeChanges: [
          {
            offsetTicks: 420,
            envelope: {
              ...envelope,
              lowpassHz: 1800,
              highpassHz: 380,
              decaySeconds: 0.09,
            },
          },
        ],
        pitch: [
          { offsetTicks: 192, semitones: 2, interpolation: "linear" },
          { offsetTicks: 384, semitones: 5, interpolation: "step" },
        ],
        vibrato: [
          {
            startOffsetTicks: 384,
            endOffsetTicks: 768,
            frequencyHz: 5.4,
            depthSemitones: 0.22,
          },
        ],
      }),
    );
    await engine.unlock();
    await engine.prepare(score, new AbortController().signal);
    engine.start(score, score.bpm, 0);

    const played: ReturnType<typeof source> =
      context.createBufferSource.mock.results[0]!.value;
    const averageRate = (2 ** (3 / 12) - 2 ** (1 / 12)) / ((Math.LN2 * 2) / 12);
    expect(played.start.mock.lastCall![1]).toBeCloseTo(
      0.02 + 0.1 * averageRate + 0.05 * 2 ** (3 / 12),
      10,
    );
    expect(played.detune.setValueAtTime.mock.calls[0]).toEqual([300, 0.025]);
    expect(
      played.detune.setValueAtTime.mock.calls.some(
        ([cents, time]) => cents === 600 && Math.abs(time - 0.075) < 1e-8,
      ),
    ).toBe(true);
    expect(
      played.detune.linearRampToValueAtTime.mock.calls.some(
        ([cents]) => cents > 610,
      ),
    ).toBe(true);
    const [lowpass, highpass] = context.createBiquadFilter.mock.results.map(
      ({ value }) => value,
    );
    expect(lowpass!.type).toBe("lowpass");
    expect(lowpass!.frequency.setValueAtTime).toHaveBeenCalledWith(6200, 0.025);
    expect(lowpass!.frequency.setTargetAtTime.mock.lastCall![0]).toBe(1800);
    expect(highpass!.frequency.setTargetAtTime.mock.lastCall![0]).toBe(380);
    const voiceGain: ReturnType<typeof param> =
      context.createGain.mock.results[2]!.value.gain;
    expect(voiceGain.setValueAtTime.mock.calls[0]).toEqual([0, 0.025]);
    expect(voiceGain.linearRampToValueAtTime.mock.lastCall![0]).toBe(0);
    expect(
      voiceGain.linearRampToValueAtTime.mock.calls.some(
        ([level, time]) => time > 0.3 && level > 0 && level < 0.12,
      ),
    ).toBe(true);
    engine.dispose();
  });

  it("leaves an exhausted sample silent on resume and freezes the tick on system interruption", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAudio);
    const { context, webAudio } = audioContext(0.2);
    const engine = new ScoreAudioEngine(() => webAudio);
    const score = plan(
      note({ endTick: 1720 }),
      note({ startTick: 960, sourceStartTick: 960, endTick: 1920 }),
    );
    await engine.unlock();
    await engine.prepare(score, new AbortController().signal);
    engine.start(score, score.bpm, 800);
    // Only the upcoming second note is queued. The first sample has no audio left.
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(
      context.createBufferSource.mock.results[0]!.value.start.mock.lastCall![1],
    ).toBe(0);
    const interrupted = vi.fn();
    engine.onInterrupted = interrupted;
    context.currentTime = 0.06;
    const tick = engine.currentTick();
    context.state = "interrupted";
    context.onstatechange?.();
    expect(interrupted).toHaveBeenCalledOnce();
    expect(
      context.createBufferSource.mock.results[0]!.value.disconnect,
    ).toHaveBeenCalledOnce();
    context.currentTime = 0.2;
    expect(engine.currentTick()).toBe(tick);
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
  });

  it("routes a full six-string chord through a high-threshold compressor and reaches the exact plan end", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchAudio);
    const { context, webAudio } = audioContext();
    const engine = new ScoreAudioEngine(() => webAudio);
    const score = plan(
      ...[64, 59, 55, 50, 45, 40].map((midi, index) =>
        note({ midi, string: index + 1 }),
      ),
    );
    await engine.unlock();
    await engine.prepare(score, new AbortController().signal);
    engine.start(score, score.bpm, 0);
    expect(context.createBufferSource).toHaveBeenCalledTimes(6);
    const master = context.createGain.mock.results[0]!.value;
    const output = context.createDynamicsCompressor.mock.results[0]!.value;
    expect(context.createDynamicsCompressor).toHaveBeenCalledOnce();
    expect(master.gain.value).toBe(1);
    expect(master.connect).toHaveBeenCalledExactlyOnceWith(output);
    expect(output.connect).toHaveBeenCalledExactlyOnceWith(context.destination);
    expect(output).toMatchObject({
      threshold: { value: -6 },
      knee: { value: 4 },
      ratio: { value: 12 },
      attack: { value: 0.003 },
      release: { value: 0.12 },
    });
    context.currentTime = 1.03;
    vi.advanceTimersByTime(25);
    expect(engine.currentTick()).toBe(score.durationTicks);
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
    expect(output.disconnect).toHaveBeenCalledOnce();
  });

  it("invalidates stopped and aborted preparation even when a decoder resolves late, then retries a failed load", async () => {
    const { context, decoded, webAudio } = audioContext();
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((url) =>
        Promise.resolve(
          String(url).endsWith("manifest.json")
            ? manifest()
            : fail
              ? new Response(null, { status: 503 })
              : new Response(new Uint8Array([1])),
        ),
      ),
    );
    const engine = new ScoreAudioEngine(() => webAudio);
    const score = plan(note());
    await engine.unlock();
    let completeDecode!: (sample: AudioBuffer) => void;
    context.decodeAudioData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeDecode = resolve;
        }),
    );
    const obsolete = engine.prepare(score, new AbortController().signal);
    const aborted = expect(obsolete).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(context.decodeAudioData).toHaveBeenCalledOnce(),
    );
    engine.stop();
    await aborted;
    completeDecode(decoded);
    expect(() => engine.start(score, score.bpm, 0)).toThrow(
      "木吉他音源尚未准备好",
    );

    fail = true;
    await expect(
      engine.prepare(score, new AbortController().signal),
    ).rejects.toThrow("木吉他采样加载或解码失败");
    fail = false;
    const signal = new AbortController();
    const cancelled = engine.prepare(score, signal.signal);
    signal.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await engine.prepare(score, new AbortController().signal);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    engine.dispose();
  });
});

describe("independent practice metronome", () => {
  it("cycles 6/8 on eighth notes, accents only one, and preserves sequence when muted", async () => {
    vi.useFakeTimers();
    const { context, webAudio } = audioContext();
    let now = 0;
    const practice = new PracticeMetronome(() => webAudio, () => now);
    const advanceTo = (time: number) => {
      now = time;
      context.currentTime = time / 1000;
      vi.advanceTimersByTime(20);
    };
    practice.initialize({ bpm: 120, meter: { numerator: 6, denominator: 8 } });
    await practice.start();
    expect(context.createOscillator.mock.results[0]!.value.start).toHaveBeenCalledWith(0.025);
    advanceTo(25);
    expect(practice.snapshot().beat).toBe(1);
    for (const time of [250, 500, 750, 1000, 1250, 1500]) advanceTo(time);
    expect(context.createOscillator.mock.results.map(({ value }) => value.frequency.value))
      .toEqual([1300, 920, 920, 920, 920, 920, 1300]);
    await practice.setMute(true);
    advanceTo(1775);
    expect(practice.snapshot()).toMatchObject({ beat: 2, mute: true, phase: "running" });
    expect(context.createOscillator).toHaveBeenCalledTimes(7);
    practice.stop();
    expect(practice.snapshot()).toMatchObject({ beat: null, phase: "stopped" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves an unavailable audio device stopped and an unsuccessful unmute running", async () => {
    vi.useFakeTimers();
    const { context, webAudio } = audioContext();
    context.resume.mockRejectedValue(new Error("device blocked"));
    let now = 0;
    const practice = new PracticeMetronome(() => webAudio, () => now);
    practice.initialize({ bpm: 120, meter: { numerator: 4, denominator: 4 } });
    await practice.start();
    expect(practice.snapshot()).toMatchObject({ phase: "stopped", beat: null, message: expect.stringContaining("声音不可用") });
    await practice.setMute(true);
    await practice.start();
    expect(practice.snapshot()).toMatchObject({ phase: "running", beat: 1, mute: true });
    await practice.setMute(false);
    now = 520;
    vi.advanceTimersByTime(20);
    expect(practice.snapshot()).toMatchObject({ phase: "running", beat: 2, mute: true, message: expect.stringContaining("已保持静音") });
    practice.stop();
  });
});
