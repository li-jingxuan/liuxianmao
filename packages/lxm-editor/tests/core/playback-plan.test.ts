import { describe, expect, it } from "vitest";
import {
  createPlaybackPlan,
  createTuningPreset,
  DEFAULT_MOCK_DOCUMENT,
  getPlaybackBeatAtTick,
  playbackSecondsToTicks,
  playbackTicksToSeconds,
  type ILXMBeat,
  type ILXMChordDiagram,
  type ILXMChordSymbol,
  type ILXMFret,
  type ILXMMeasure,
  type ILXMNote,
  type ILXMTechnique,
  type ILXMTrack,
  type PlaybackPlanOptions,
} from "../../src";

const beat = (
  id: string,
  tick: number,
  notes: readonly (readonly [string: number, fret: ILXMFret])[] = [],
  rhythm: ILXMBeat["rhythm"] = { base: "quarter", dots: 0 },
): ILXMBeat => ({
  id, tick, rhythm, kind: notes.length ? "notes" : "rest",
  notes: notes.map(([string, fret]) => ({ id: `${id}-${string}`, string, fret })),
});

const measure = (id: string, beats: ILXMBeat[], barline: ILXMMeasure["barline"] = "single"): ILXMMeasure => ({
  id, beats, barline, timeSignature: { numerator: 4, denominator: 4 },
  chordSymbols: [], lyrics: [], tuplets: [], numberedVoice: { events: [], tuplets: [] },
});

const track = (measures: ILXMMeasure[], techniques: ILXMTechnique[] = []): ILXMTrack => ({
  id: "guitar", name: "Guitar", instrument: "guitar", tuning: createTuningPreset("standard"),
  capo: 0, startBarline: "none", measures, techniques, numberedMarks: [],
});

const diagram = (fretsHighToLow: ILXMChordDiagram["strings"][number]["fret"][]): ILXMChordDiagram => ({
  startFret: 1, fretCount: 5, barres: [],
  strings: ([1, 2, 3, 4, 5, 6] as const).map((string) => ({
    string, fret: fretsHighToLow[string - 1]!, finger: null,
  })),
});

const cMajor = diagram([0, 1, 0, 2, 3, "x"]);
const chord = (beatId: string, name: string, diagram: ILXMChordDiagram | null): ILXMChordSymbol => ({
  id: `chord-${beatId}`, beatId, display: "name", chord: { name, diagram },
});

const catalog: PlaybackPlanOptions["chordCatalog"] = {
  tuningId: "guitar-standard",
  items: [{
    rootPc: 0, quality: "major", defaultVoicingId: "open",
    voicings: [
      { id: "higher", diagram: diagram([8, 8, 9, 10, "x", "x"]) },
      { id: "open", diagram: cMajor },
    ],
  }],
};

describe("guitar playback plan", () => {
  it("每次反复都按弱起的实际时长推进，完整小节仍走完尾部休止", () => {
    const pickup = measure("pickup", [beat("up", 0, [[1, 3]], { base: "eighth", dots: 0 })]);
    pickup.actualDurationTicks = 480;
    const full = measure("full", [
      beat("down", 0, [[2, 2]], { base: "half", dots: 0 }),
      beat("silence", 1920, [], { base: "half", dots: 0 }),
    ], "repeatEnd");
    const plan = createPlaybackPlan(track([pickup, full]));
    expect(plan.visits.map(({ startTick, endTick }) => [startTick, endTick])).toEqual([
      [0, 480], [480, 4320], [4320, 4800], [4800, 8640],
    ]);
    expect(plan.sounds.map(({ startTick }) => startTick)).toEqual([0, 480, 4320, 4800]);
  });

  it("resolves saved chord frets per string, carries them across bars, and keeps muted strings quiet", () => {
    const first = measure("first", [beat("a", 0, [[5, "x"], [1, 3], [6, "x"]]), beat("b", 960, [[4, "x"]])]);
    const second = measure("second", [beat("c", 0, [[2, "x"]]), beat("d", 960, [[2, "x"], [1, 0]])]);
    first.chordSymbols = [chord("a", "C", cMajor)];
    second.chordSymbols = [chord("d", "unknown", null)];
    const source = track([first, second]);
    const snapshot = structuredClone(source);
    const plan = createPlaybackPlan(source, { chordCatalog: catalog });
    expect(plan.sounds.map(({ beatId, string, midi, startTick }) => [beatId, string, midi, startTick]))
      .toEqual([["a", 5, 48, 0], ["a", 1, 67, 0], ["b", 4, 52, 960], ["c", 2, 60, 3840], ["d", 1, 64, 4800]]);
    expect(plan.warnings).toEqual([{ code: "missingChordVoicing", measureIds: ["second"] }]);
    expect(source).toEqual(snapshot);
  });

  it("uses the exact catalog default in standard tuning, preserves explicit voicings and adds capo once", () => {
    const bar = measure("bar", [beat("a", 0, [[5, "x"]]), beat("b", 960, [[5, "x"]]), beat("c", 1920, [[5, "x"]])]);
    bar.chordSymbols = [chord("a", "B♯maj", null), chord("b", "Cm", null), chord("c", "C", diagram([0, 1, 0, 2, 4, "x"]))];
    const source = track([bar]);
    source.capo = 2;
    expect(createPlaybackPlan(source, { chordCatalog: catalog }).sounds.map(({ midi }) => midi)).toEqual([50, 51]);
    source.tuning = createTuningPreset("openG");
    const custom = createPlaybackPlan(source, { chordCatalog: catalog });
    expect(custom.sounds.map(({ midi }) => midi)).toEqual([49]);
    expect(custom.warnings).toEqual([{ code: "missingChordVoicing", measureIds: ["bar"] }]);
  });

  it("coalesces unplayable pitch and missing chord warnings while keeping the beat and other strings", () => {
    const source = track([
      measure("a", [beat("a", 0, [[6, 0], [3, "x"], [1, 4]])]),
      measure("b", [beat("b", 0, [[4, "x"], [2, "x"]])]),
    ]);
    const plan = createPlaybackPlan(source, { midiRange: [45, 70] });
    expect(plan.sounds.map(({ midi }) => midi)).toEqual([68]);
    expect(plan.beats.map(({ beatId }) => beatId)).toEqual(["a", "b"]);
    expect(plan.warnings).toEqual([
      { code: "outOfRangePitch", measureIds: ["a"] },
      { code: "missingChordVoicing", measureIds: ["a", "b"] },
    ]);
  });

  it("preserves written, dotted and tuplet durations, measure capacity, and silent beat lookup", () => {
    const first = measure("first", [
      beat("quarter", 0, [[1, 0]]), beat("dotted", 960, [], { base: "quarter", dots: 1 }),
      ...[2400, 2720, 3040].map((tick, index) => beat(`triplet${index}`, tick, [[2, "x"]], { base: "eighth", dots: 0 })),
      beat("rest", 3360, [], { base: "eighth", dots: 0 }),
    ]);
    first.tuplets = [{ id: "tuple", beatIds: ["triplet0", "triplet1", "triplet2"], ratio: { actual: 3, normal: 2 } }];
    first.chordSymbols = [chord("dotted", "C", cMajor)];
    const second = measure("second", [beat("six-eight", 0, [[4, "x"]], { base: "half", dots: 1 })]);
    second.timeSignature = { numerator: 6, denominator: 8 };
    const plan = createPlaybackPlan(track([first, second]), { bpm: 120 });
    const toSeconds = (ticks: number) => playbackTicksToSeconds(ticks, plan.bpm);
    expect(plan.visits.map(({ startTick, endTick }) => [startTick, endTick])).toEqual([[0, 3840], [3840, 6720]]);
    expect(plan.sounds.map(({ startTick }) => startTick)).toEqual([0, 2400, 2720, 3040, 3840]);
    expect(plan.beats.map(({ startTick, endTick }) => endTick - startTick)).toEqual([960, 1440, 320, 320, 320, 480, 2880]);
    expect([toSeconds(960), toSeconds(1440), toSeconds(6720)]).toEqual([0.5, 0.75, 3.5]);
    expect(playbackSecondsToTicks(0.75, 120)).toBe(1440);
    expect(getPlaybackBeatAtTick(plan, 960)?.beatId).toBe("dotted");
    expect(getPlaybackBeatAtTick(plan, 3360)?.beatId).toBe("rest");
    expect(getPlaybackBeatAtTick(plan, 6720)).toBeUndefined();
    expect(createPlaybackPlan(track([]), { bpm: Infinity }).bpm).toBe(90);
    expect(createPlaybackPlan(track([]), { bpm: 10 }).bpm).toBe(20);
    expect(createPlaybackPlan(track([]), { bpm: 350 }).bpm).toBe(300);
  });

  it("treats a pure dash as whole-beat sustain and a mixed dash as per-string sustain", () => {
    const bar = measure("bar", [
      beat("a", 0, [[1, 0], [2, 0]], { base: "eighth", dots: 0 }),
      beat("b", 480, [[3, "-"]], { base: "eighth", dots: 0 }),
      beat("c", 960, [[1, "-"], [3, 2]], { base: "eighth", dots: 0 }),
      beat("d", 1440, []), beat("e", 2400, [[3, "-"]]),
    ]);
    expect(createPlaybackPlan(track([bar])).sounds.map(({ noteId, endTick }) => [noteId, endTick]))
      .toEqual([["a-1", 1440], ["a-2", 960], ["c-3", 1440]]);
  });

  it("starts from the first selected visit, restores written chord context, and breaks continuations on jumps", () => {
    const a = measure("a", [beat("a", 0, [[1, "x"]], { base: "whole", dots: 0 })]);
    const b = measure("b", [beat("b", 0, [[1, "x"]], { base: "whole", dots: 0 })]);
    const c = measure("c", [beat("c", 0, [[1, "x"]], { base: "whole", dots: 0 })], "repeatEnd");
    const d = measure("d", [beat("d", 0, [[3, "-"]], { base: "whole", dots: 0 })]);
    a.chordSymbols = [chord("a", "C", cMajor)];
    c.chordSymbols = [chord("c", "E", diagram([4, 0, 1, 2, 2, 0]))];
    const source = track([a, b, c, d]);
    const plan = createPlaybackPlan(source, { startMeasureId: "b" });
    expect(plan.visits.map(({ measureId, visitIndex, jumped }) => [measureId, visitIndex, jumped])).toEqual([
      ["b", 1, false], ["c", 2, false], ["a", 3, true], ["b", 4, false], ["c", 5, false], ["d", 6, false],
    ]);
    expect(plan.sounds.map(({ midi }) => midi)).toEqual([64, 68, 64, 64, 68]);
    expect(plan.sounds.at(-1)?.endTick).toBe(plan.durationTicks);

    a.beats[0]!.notes[0]!.fret = "-";
    const repeated = createPlaybackPlan(source);
    expect(repeated.sounds.filter(({ noteId }) => noteId === "c-1").map(({ endTick }) => endTick)).toEqual([11520, 26880]);
    expect(repeated.sounds.some(({ beatId }) => beatId === "a")).toBe(false);
  });

  it("expands repeatBoth and ignores a standalone left repeat, but falls back for nested and crossing boundaries", () => {
    const bars = [measure("a", [], "repeatBoth"), measure("b", [], "repeatEnd"), measure("c", [], "repeatStart")];
    const source = track(bars);
    expect(createPlaybackPlan(source).visits.map(({ measureId }) => measureId)).toEqual(["a", "a", "b", "b", "c"]);
    expect(createPlaybackPlan(source).warnings).toEqual([]);

    bars[0]!.barline = "repeatStart";
    source.startBarline = "repeatStart";
    const nested = createPlaybackPlan(source);
    expect(nested.visits.map(({ measureId }) => measureId)).toEqual(["a", "b", "c"]);
    expect(nested.warnings).toEqual([{ code: "invalidRepeat", measureIds: ["a"] }]);

    bars[0]!.barline = "repeatEnd";
    const implicitOverlap = createPlaybackPlan(source);
    expect(implicitOverlap.visits.map(({ measureId }) => measureId)).toEqual(["a", "b", "c"]);
    expect(implicitOverlap.warnings).toEqual([{ code: "invalidRepeat", measureIds: ["b"] }]);
  });

  it("maps the published 理想 chord counts before applying the techniques", () => {
    const source = DEFAULT_MOCK_DOCUMENT.score.tracks[0]!;
    const notes = new Map<string, ILXMNote>(source.measures.flatMap((bar) => bar.beats.flatMap((beat) =>
      beat.notes.map((note) => [note.id, note] as const))));
    const baseline = createPlaybackPlan({ ...source, techniques: [] });
    expect([...notes.values()].filter(({ fret }) => fret === "x")).toHaveLength(252);
    // 新版谱面有 251 个可按和弦指法发声的叉音，第 17 至 33 小节反复时再播放其中 103 个。
    expect(baseline.sounds.filter(({ noteId }) => notes.get(noteId!)?.fret === "x")).toHaveLength(354);
    expect(baseline.sounds.filter(({ noteId }) => typeof notes.get(noteId!)?.fret === "number")).toHaveLength(50);
    expect(baseline.warnings).toEqual([]);
    const plan = createPlaybackPlan(DEFAULT_MOCK_DOCUMENT);
    expect(plan.sounds.some(({ techniques }) => techniques.includes("tie"))).toBe(true);
    expect(plan.sounds.some(({ techniques }) => techniques.includes("arpeggio"))).toBe(true);
  });

  it("plays the marked Asus2, Dsus2 and Gadd9 notes in bars 11 and 12 of 理想", () => {
    const { sounds } = createPlaybackPlan(DEFAULT_MOCK_DOCUMENT);
    const measures = DEFAULT_MOCK_DOCUMENT.score.tracks[0]!.measures;
    for (const [bar, tick, string, midi] of [
      [11, 0, 5, 45], [11, 1920, 4, 50], [11, 3120, 1, 64],
      [12, 0, 5, 48], [12, 480, 4, 52],
    ] as const) {
      const beatId = measures[bar - 1]!.beats.find((beat) => beat.tick === tick)!.id;
      expect(sounds).toContainEqual(expect.objectContaining({ beatId, string, midi }));
    }
  });
});

describe("playback techniques", () => {
  it.each([
    ["hammerOn", 3, 5, 69],
    ["pullOff", 5, 0, 64],
  ] as const)("plays %s with a reduced target attack and bridges notes on other strings", (type, from, to, midi) => {
    const bar = measure("bar", [beat("a", 0, [[1, from]]), beat("b", 960, [[2, 0]]), beat("c", 1920, [[1, to]])]);
    const plan = createPlaybackPlan(track([bar], [{ id: "link", type, fromNoteId: "a-1", toNoteId: "c-1" }]));
    expect(plan.sounds[0]).toMatchObject({ noteId: "a-1", endTick: 1920, attack: "pluck" });
    expect(plan.sounds[2]).toMatchObject({ noteId: "c-1", startTick: 1920, midi, attack: type, techniques: [type] });
    expect(plan.sounds[2]!.envelope.sampleOffsetSeconds).toBeGreaterThan(plan.sounds[0]!.envelope.sampleOffsetSeconds);
  });

  it.each([
    ["slideUp", 3, 5, 2],
    ["slideDown", 5, 3, -2],
  ] as const)("sustains one voice for %s and reaches its target over the barline", (type, from, to, interval) => {
    const first = measure("one", [beat("a", 2880, [[1, from]])]);
    const second = measure("two", [beat("b", 0, [[1, to]])]);
    const source = track([first, second], [{ id: "slide", type, fromNoteId: "a-1", toNoteId: "b-1" }]);
    const full = createPlaybackPlan(source);
    const [sound] = full.sounds;
    expect(full.sounds).toHaveLength(1);
    expect(sound).toMatchObject({ startTick: 2880, endTick: 4800, midi: 64 + from, targetMidi: 64 + to, techniques: [type] });
    expect(sound!.pitch.at(-1)).toEqual({ offsetTicks: 960, semitones: interval, interpolation: "linear" });
    expect(sound!.pitch.at(-2)!.offsetTicks).toBeLessThan(960);
    const fromSecond = createPlaybackPlan(source, { startMeasureId: "two" });
    expect(fromSecond.sounds).toEqual([{ ...sound, startTick: 0, sourceStartTick: -960, endTick: 960 }]);
  });

  it("keeps a slide voice when hammer-on also marks the target, with an arrival envelope change", () => {
    const bar = measure("bar", [beat("a", 0, [[1, 3]]), beat("b", 960, [[1, 5]])]);
    const pair = { fromNoteId: "a-1", toNoteId: "b-1" };
    const plan = createPlaybackPlan(track([bar], [
      { id: "slide", type: "slideUp", ...pair }, { id: "hammer", type: "hammerOn", ...pair },
    ]));
    expect(plan.sounds).toHaveLength(1);
    expect(plan.sounds[0]).toMatchObject({ attack: "pluck", techniques: ["slideUp", "hammerOn"], targetMidi: 69 });
    expect(plan.sounds[0]!.envelopeChanges).toMatchObject([{ offsetTicks: 960, envelope: { gain: 0.7 } }]);
  });

  it("ignores a contradictory direction and warns once even when the measure repeats", () => {
    const bar = measure("bar", [beat("a", 0, [[1, 3]]), beat("b", 960, [[1, "x"]])], "repeatEnd");
    bar.chordSymbols = [chord("b", "E", diagram([5, 0, 1, 2, 2, 0]))];
    const pair = { fromNoteId: "a-1", toNoteId: "b-1" };
    const plan = createPlaybackPlan(track([bar], [
      { id: "wrong", type: "slideDown", ...pair }, { id: "right", type: "slideUp", ...pair },
    ]));
    expect(plan.sounds.map(({ targetMidi, techniques }) => [targetMidi, techniques])).toEqual([[69, ["slideUp"]], [69, ["slideUp"]]]);
    expect(plan.warnings).toEqual([{ code: "conflictingTechnique", measureIds: ["bar"] }]);
  });

  it("ties three resolved same-pitch notes into one event, including a cross-measure start", () => {
    const first = measure("one", [beat("a", 2880, [[5, "x"]])]);
    first.chordSymbols = [chord("a", "C", cMajor)];
    const second = measure("two", [beat("b", 0, [[5, 3]]), beat("c", 960, [[5, "x"]])]);
    const source = track([first, second], [
      { id: "tie1", type: "tie", fromNoteId: "a-5", toNoteId: "b-5" },
      { id: "tie2", type: "tie", fromNoteId: "b-5", toNoteId: "c-5" },
    ]);
    const full = createPlaybackPlan(source);
    expect(full.sounds).toMatchObject([{ noteId: "a-5", startTick: 2880, endTick: 5760, midi: 48, techniques: ["tie"] }]);
    expect(createPlaybackPlan(source, { startMeasureId: "two" }).sounds).toMatchObject([
      { noteId: "a-5", startTick: 0, sourceStartTick: -960, endTick: 1920 },
    ]);
    second.chordSymbols = [chord("c", "D", diagram([2, 3, 2, 0, 5, "x"]))];
    const mismatch = createPlaybackPlan(source);
    expect(mismatch.sounds.map(({ noteId, midi }) => [noteId, midi])).toEqual([["a-5", 48], ["c-5", 50]]);
    expect(mismatch.warnings).toEqual([{ code: "invalidConnection", measureIds: ["two"] }]);
  });

  it("keeps playable endpoints when a rest, a muted chord or a repeat jump prevents a connection", () => {
    const first = measure("one", [beat("a", 0, [[6, 0]]), beat("rest", 960), beat("b", 1920, [[6, 2]]), beat("c", 2880, [[6, "x"]])], "repeatEnd");
    const second = measure("two", [beat("d", 0, [[6, 3]])]);
    first.chordSymbols = [chord("c", "C", cMajor)];
    const plan = createPlaybackPlan(track([first, second], [
      { id: "slide", type: "slideUp", fromNoteId: "a-6", toNoteId: "b-6" },
      { id: "unpitched", type: "hammerOn", fromNoteId: "b-6", toNoteId: "c-6" },
      { id: "across", type: "slideUp", fromNoteId: "c-6", toNoteId: "d-6" },
    ]));
    expect(plan.sounds.map(({ noteId, attack }) => [noteId, attack])).toEqual([
      ["a-6", "pluck"], ["b-6", "pluck"], ["a-6", "pluck"], ["b-6", "pluck"], ["d-6", "pluck"],
    ]);
    expect(plan.warnings).toEqual([{ code: "invalidConnection", measureIds: ["one", "two"] }]);
  });

  it.each([1, 2] as const)("pushes the bend up %i semitone(s) and adds vibrato on the same voice", (semitones) => {
    const bar = measure("bar", [beat("a", 0, [[1, 3]], { base: "sixteenth", dots: 0 })]);
    const plan = createPlaybackPlan(track([bar], [
      { id: "bend", type: "bend", fromNoteId: "a-1", semitones },
      { id: "vibrato", type: "vibrato", fromNoteId: "a-1" },
    ]));
    const [sound] = plan.sounds;
    expect(plan.sounds).toHaveLength(1);
    expect(sound).toMatchObject({ midi: 67, targetMidi: 67 + semitones, techniques: ["bend", "vibrato"] });
    expect(sound!.pitch).toEqual([
      { offsetTicks: 0, semitones: 0, interpolation: "step" },
      { offsetTicks: 132, semitones, interpolation: "linear" },
    ]);
    expect(sound!.vibrato).toEqual([{ startOffsetTicks: 48, endOffsetTicks: 240, frequencyHz: 5.4, depthSemitones: 0.22 }]);
    const limited = createPlaybackPlan(track([bar], [{ id: "bend", type: "bend", fromNoteId: "a-1", semitones }]), { midiRange: [45, 67] });
    expect(limited.sounds[0]?.targetMidi).toBe(67);
    expect(limited.warnings).toEqual([{ code: "outOfRangePitch", measureIds: ["bar"] }]);
  });

  it("resolves natural harmonic nodes relative to capo and flags an unmapped node", () => {
    const nodes = [12, 7, 19, 5, 24, 4];
    const beats = nodes.map((fret, i) => beat(`b${i}`, i * 480, [[6, fret]], { base: "eighth", dots: 0 }));
    const source = track([measure("bar", beats)], beats.map(({ id }) => ({
      id: `harmonic-${id}`, type: "naturalHarmonic", fromNoteId: `${id}-6`,
    })));
    source.capo = 2;
    const plan = createPlaybackPlan(source);
    expect(plan.sounds.map(({ midi }) => midi)).toEqual([54, 61, 61, 66, 66, 46]);
    expect(plan.sounds[0]?.envelope.highpassHz).toBeGreaterThan(0);
    expect(plan.warnings).toEqual([{ code: "approximateHarmonic", measureIds: ["bar"] }]);
  });

  it("plays artificial harmonics an octave high with a brighter envelope", () => {
    const bar = measure("bar", [beat("a", 0, [[6, 3]]), beat("b", 960, [[6, 3]])]);
    const plan = createPlaybackPlan(track([bar], [{ id: "harmonic", type: "artificialHarmonic", fromNoteId: "a-6" }]));
    expect(plan.sounds.map(({ midi, envelope }) => [midi, envelope.highpassHz])).toEqual([[55, 380], [43, null]]);
  });

  it("taps on the same pitch and onset using a shortened transient", () => {
    const bar = measure("bar", [beat("a", 0, [[1, 5]]), beat("b", 960, [[1, 5]])]);
    const plan = createPlaybackPlan(track([bar], [{ id: "tap", type: "tapping", fromNoteId: "a-1" }]));
    expect(plan.sounds.map(({ midi, startTick, attack }) => [midi, startTick, attack])).toEqual([[69, 0, "tapping"], [69, 960, "pluck"]]);
    expect(plan.sounds[0]!.envelope.sampleOffsetSeconds).toBeGreaterThan(plan.sounds[1]!.envelope.sampleOffsetSeconds);
  });

  it.each([7, 8])("trills to auxiliary fret %i within a short beat and retains its steps on resume", (auxiliaryFret) => {
    const bar = measure("bar", [beat("a", 0, [[1, 5]], { base: "thirtySecond", dots: 0 })]);
    const plan = createPlaybackPlan(track([bar], [
      { id: "trill", type: "trill", fromNoteId: "a-1", auxiliaryFret },
    ]), { bpm: 240 });
    expect(plan.sounds).toHaveLength(1);
    expect(plan.sounds[0]).toMatchObject({ midi: 69, targetMidi: 64 + auxiliaryFret, endTick: 120, pitch: [
      { offsetTicks: 0, semitones: 0, interpolation: "step" },
      { offsetTicks: 60, semitones: auxiliaryFret - 5, interpolation: "step" },
    ] });
  });

  it.each(["down", "up"] as const)("strums %s inside the chosen range and mutes each swept voice", (stroke) => {
    const bar = measure("bar", [beat("a", 0, [[2, 2], [3, 2], [4, 2], [5, 2]], { base: "thirtySecond", dots: 0 })]);
    const plan = createPlaybackPlan(track([bar], [
      { id: "strum", type: "strum", beatId: "a", minString: 3, maxString: 5, stroke },
      { id: "mute", type: "palmMute", fromBeatId: "a", toBeatId: "a" },
    ]), { bpm: 240 });
    expect(plan.sounds.map(({ string }) => string)).toEqual(stroke === "down" ? [2, 5, 4, 3] : [2, 3, 4, 5]);
    expect(plan.sounds[0]).toMatchObject({ onsetOffsetTicks: 0, techniques: ["palmMute"] });
    expect(plan.sounds[1]).toMatchObject({ onsetOffsetTicks: 0, techniques: ["strum", "palmMute"] });
    expect(plan.sounds.at(-1)!.startTick).toBeLessThan(120);
    expect(plan.sounds.every(({ envelope }) => envelope.lowpassHz === 1800 && envelope.decaySeconds === 0.09)).toBe(true);
  });

  it.each(["ascending", "descending"] as const)("arpeggiates %s by real pitch on a chord-marked empty beat", (direction) => {
    const bar = measure("bar", [beat("a", 0), beat("b", 960)]);
    bar.chordSymbols = [chord("a", "Crossed", diagram([0, "x", 10, 15, 0, "x"]))];
    const source = track([bar], [{ id: "arp", type: "arpeggio", beatId: "a", minString: 2, maxString: 5, direction }]);
    const plan = createPlaybackPlan(source);
    expect(plan.sounds.map(({ string, midi }) => [string, midi])).toEqual(
      direction === "ascending" ? [[5, 45], [3, 65], [4, 65]] : [[3, 65], [4, 65], [5, 45]],
    );
    expect(plan.sounds.every(({ noteId, beatId }) => noteId === null && beatId === "a")).toBe(true);
    expect(plan.sounds[1]!.onsetOffsetTicks).toBeGreaterThan(17);
    expect(createPlaybackPlan({ ...source, techniques: [] }).sounds).toEqual([]);
  });

  it("chains traversal ties on matching swept strings while preserving other attacks and note connections", () => {
    const bar = measure("bar", [
      beat("a", 0, [[1, 0], [2, 1], [3, 0], [4, 2], [5, 3]]),
      beat("b", 960),
      beat("c", 1920, [[2, 1], [3, 2], [4, 2]]),
      beat("d", 2880, [[3, 4], [4, 2]]),
    ]);
    bar.chordSymbols = [chord("b", "Cadd9", diagram([0, 1, 2, 2, 3, "x"]))];
    const source = track([bar], [
      { id: "strum-a", type: "strum", beatId: "a", minString: 2, maxString: 5, stroke: "down" },
      { id: "arp-b", type: "arpeggio", beatId: "b", minString: 1, maxString: 4, direction: "ascending" },
      { id: "strum-c", type: "strum", beatId: "c", minString: 2, maxString: 4, stroke: "up" },
      { id: "tie-ab", type: "traversalTie", fromBeatId: "a", toBeatId: "b" },
      { id: "tie-bc", type: "traversalTie", fromBeatId: "b", toBeatId: "c" },
      { id: "tie-d", type: "tie", fromNoteId: "c-4", toNoteId: "d-4" },
      { id: "hammer-d", type: "hammerOn", fromNoteId: "c-3", toNoteId: "d-3" },
    ]);
    const plan = createPlaybackPlan(source);
    expect(plan.sounds.map(({ beatId, string, midi, endTick }) => [beatId, string, midi, endTick])).toEqual([
      ["a", 1, 64, 960], ["a", 5, 48, 960], ["a", 4, 52, 3840], ["a", 3, 55, 960], ["a", 2, 60, 2880],
      ["b", 3, 57, 2880], ["b", 1, 64, 1920], ["d", 3, 59, 3840],
    ]);
    expect(plan.sounds[2]?.techniques).toEqual(["strum", "traversalTie", "arpeggio", "tie"]);
    expect(plan.sounds.at(-1)?.attack).toBe("hammerOn");
    const baseline = createPlaybackPlan({ ...source, techniques: source.techniques.filter(({ type }) => type !== "traversalTie") });
    for (const { string, startTick } of plan.sounds.filter(({ beatId }) => beatId === "b")) {
      expect(baseline.sounds.find((sound) => sound.beatId === "b" && sound.string === string)?.startTick).toBe(startTick);
    }
    expect(plan.warnings).toEqual([]);
  });

  it("carries across sequential bar visits and starts a new traversal attack at a repeat jump", () => {
    const whole = { base: "whole", dots: 0 } as const;
    const first = measure("one", [beat("a", 0, [], whole)]);
    const second = measure("two", [beat("b", 0, [], whole)], "repeatEnd");
    const third = measure("three", [beat("c", 0, [[5, 3]], whole)]);
    first.chordSymbols = [chord("a", "C", cMajor)];
    const source = track([first, second, third], [
      { id: "strum-a", type: "strum", beatId: "a", minString: 5, maxString: 6, stroke: "down" },
      { id: "strum-b", type: "strum", beatId: "b", minString: 5, maxString: 6, stroke: "up" },
      { id: "strum-c", type: "strum", beatId: "c", minString: 5, maxString: 6, stroke: "down" },
      { id: "tie-ab", type: "traversalTie", fromBeatId: "a", toBeatId: "b" },
      { id: "tie-bc", type: "traversalTie", fromBeatId: "b", toBeatId: "c" },
    ]);
    const plan = createPlaybackPlan(source);
    expect(plan.sounds.map(({ beatId, visitIndex, startTick, endTick }) => [beatId, visitIndex, startTick, endTick])).toEqual([
      ["a", 0, 0, 7680], ["a", 2, 7680, 19200],
    ]);
    expect(createPlaybackPlan(source, { startMeasureId: "two" }).sounds).toMatchObject([
      { noteId: null, beatId: "a", startTick: 0, sourceStartTick: -3840, endTick: 3840 },
      { noteId: null, beatId: "a", startTick: 3840, sourceStartTick: 3840, endTick: 15360 },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("keeps a traversal attack across a timing gap or an unresolved intermediate voice", () => {
    const bar = measure("bar", [beat("a", 0), beat("b", 1920), beat("c", 2880)]);
    bar.chordSymbols = [
      chord("a", "C", cMajor),
      chord("b", "No fifth string", diagram([0, 1, 0, 2, "x", "x"])),
      chord("c", "C", cMajor),
    ];
    const source = track([bar], [
      ...bar.beats.map(({ id }) => ({
        id: `strum-${id}`, type: "strum" as const, beatId: id, minString: 4 as const, maxString: 5 as const, stroke: "down" as const,
      })),
      { id: "tie-ab", type: "traversalTie", fromBeatId: "a", toBeatId: "b" },
      { id: "tie-bc", type: "traversalTie", fromBeatId: "b", toBeatId: "c" },
    ]);
    expect(createPlaybackPlan(source).sounds.map(({ beatId, string, endTick }) => [beatId, string, endTick])).toEqual([
      ["a", 5, 960], ["a", 4, 960], ["b", 4, 3840], ["c", 5, 3840],
    ]);
  });

  it("allows a dash to sustain a sounded chord traversal on a rest beat", () => {
    const bar = measure("bar", [beat("a", 0), beat("b", 960, [[3, "-"]])]);
    bar.chordSymbols = [chord("a", "C", cMajor)];
    const source = track([bar], [{ id: "strum", type: "strum", beatId: "a", minString: 4, maxString: 6, stroke: "down" }]);
    expect(createPlaybackPlan(source).sounds.map(({ string, endTick }) => [string, endTick])).toEqual([[5, 1920], [4, 1920]]);
    expect(createPlaybackPlan({ ...source, techniques: [] }).sounds).toEqual([]);
  });

  it("allows a dash to sustain a traversal tie carried into a rest beat", () => {
    const bar = measure("bar", [beat("a", 0), beat("b", 960), beat("c", 1920, [[3, "-"]])]);
    bar.chordSymbols = [chord("a", "C", cMajor)];
    const source = track([bar], [
      { id: "strum-a", type: "strum", beatId: "a", minString: 4, maxString: 6, stroke: "down" },
      { id: "strum-b", type: "strum", beatId: "b", minString: 4, maxString: 6, stroke: "up" },
      { id: "tie-ab", type: "traversalTie", fromBeatId: "a", toBeatId: "b" },
    ]);
    expect(createPlaybackPlan(source).sounds.map(({ beatId, string, endTick }) => [beatId, string, endTick])).toEqual([
      ["a", 5, 2880], ["a", 4, 2880],
    ]);
  });

  it("distinguishes up and down pick strokes without affecting the note timing", () => {
    const bar = measure("bar", [beat("a", 0, [[1, 0]]), beat("b", 960, [[1, 0]])]);
    const plan = createPlaybackPlan(track([bar], [
      { id: "down", type: "pickStroke", beatId: "a", stroke: "down" },
      { id: "up", type: "pickStroke", beatId: "b", stroke: "up" },
    ]));
    expect(plan.sounds.map(({ midi, startTick, pickStroke }) => [midi, startTick, pickStroke])).toEqual([[64, 0, "down"], [64, 960, "up"]]);
    expect(plan.sounds[0]!.envelope).not.toEqual(plan.sounds[1]!.envelope);
  });

  it("keeps a muted dash continuation attenuated and restores the following newly plucked note", () => {
    const bar = measure("bar", [beat("a", 0, [[1, 0]]), beat("b", 960, [[3, "-"]]), beat("c", 1920, [[1, 1]])]);
    const plan = createPlaybackPlan(track([bar], [{ id: "mute", type: "palmMute", fromBeatId: "b", toBeatId: "b" }]));
    expect(plan.sounds).toMatchObject([
      { noteId: "a-1", endTick: 1920, envelopeChanges: [{ offsetTicks: 960, envelope: { decaySeconds: 0.09 } }] },
      { noteId: "c-1", envelope: { decaySeconds: null } },
    ]);
  });

  it("applies palm mute to a slide sustained retroactively through an intervening beat", () => {
    const bar = measure("bar", [beat("a", 0, [[1, 3]]), beat("b", 960, [[2, 0]]), beat("c", 1920, [[1, 5]])]);
    const plan = createPlaybackPlan(track([bar], [
      { id: "slide", type: "slideUp", fromNoteId: "a-1", toNoteId: "c-1" },
      { id: "mute", type: "palmMute", fromBeatId: "b", toBeatId: "b" },
    ]));
    expect(plan.sounds).toMatchObject([
      { noteId: "a-1", endTick: 2880, techniques: ["slideUp", "palmMute"],
        envelopeChanges: [{ offsetTicks: 960, envelope: { decaySeconds: 0.09 } }] },
      { noteId: "b-2", envelope: { decaySeconds: 0.09 } },
    ]);
  });

  it("lets strings overlap across measures, unions same-type ranges, and truncates at a reattack or repeat jump", () => {
    const first = measure("one", [beat("a", 2880, [[1, 0]])], "repeatEnd");
    const second = measure("two", [beat("b", 0, [[2, 0]]), beat("c", 960, [[1, 0]]), beat("d", 1920, [[3, 0]])]);
    const plan = createPlaybackPlan(track([first, second], [
      { id: "ring1", type: "letRing", fromBeatId: "a", toBeatId: "b" },
      { id: "ring2", type: "letRing", fromBeatId: "b", toBeatId: "d" },
    ]));
    expect(plan.sounds.map(({ noteId, startTick, endTick }) => [noteId, startTick, endTick])).toEqual([
      ["a-1", 2880, 3840], ["a-1", 6720, 8640], ["b-2", 7680, 10560],
      ["c-1", 8640, 10560], ["d-3", 9600, 10560],
    ]);
  });
});
