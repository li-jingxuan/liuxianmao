import type { ILXMNote, ILXMStrokeDirection, ILXMTechniqueType, ILXMTrack } from "../types";
import { isPureTabContinuationBeat } from "../rhythm/tab-continuation";
import { usesChordVoicingForTraversal } from "../techniques/technique-rules";
import type { PlaybackEnvelope, PlaybackEnvelopeChange, PlaybackPitchPoint, PlaybackSound, PlaybackVibrato } from "./plan";
import { indexPlaybackTechniques, rangeAtOrder, type PlaybackTechniqueIndex } from "./techniques";
import type { PlaybackRun, TimedBeat, Warn } from "./timeline";

interface Tone {
  noteId: string | null;
  string: number;
  midi: number;
  endMidi: number;
  auxiliaryMidi: number | undefined;
  tags: ILXMTechniqueType[];
  offset: number;
}

type Voice = Omit<PlaybackSound, "techniques" | "pitch" | "vibrato" | "envelopeChanges"> & {
  techniques: ILXMTechniqueType[];
  pitch: PlaybackPitchPoint[];
  vibrato: PlaybackVibrato[];
  envelopeChanges: PlaybackEnvelopeChange[];
};

interface Endpoint {
  beat: TimedBeat;
  tone?: Tone;
  voice?: Voice;
}

const harmonicIntervals = new Map([[12, 12], [7, 19], [19, 19], [5, 24], [24, 24]]);
const fitTicks = (seconds: number, ticksPerSecond: number) => Math.round(seconds * ticksPerSecond);

function resolveTone(
  beat: TimedBeat,
  note: Pick<ILXMNote, "string" | "fret">,
  noteId: string | null,
  tuning: ReadonlyMap<number, number>,
  techniques: PlaybackTechniqueIndex,
  supports: (midi: number) => boolean,
  warn: Warn,
): Tone | undefined {
  const { string } = note;
  const fret = note.fret === "x" ? beat.frets?.get(string) : note.fret;
  if (fret === undefined) warn("missingChordVoicing", beat.measureId);
  if (typeof fret !== "number") return;

  const open = tuning.get(string);
  if (open === undefined) {
    warn("outOfRangePitch", beat.measureId);
    return;
  }

  let midi = open + fret;
  let bend = 0;
  let auxiliaryMidi: number | undefined;
  const tags: ILXMTechniqueType[] = [];
  for (const effect of (noteId === null ? [] : techniques.single.get(noteId) ?? [])) {
    switch (effect.type) {
      case "naturalHarmonic": {
        const interval = harmonicIntervals.get(fret);
        if (interval === undefined) warn("approximateHarmonic", beat.measureId);
        else midi = open + interval;
        break;
      }
      case "artificialHarmonic": midi += 12; break;
      case "bend": bend = effect.semitones; break;
      case "trill": auxiliaryMidi = open + effect.auxiliaryFret; break;
    }
    tags.push(effect.type);
  }
  if (!supports(midi)) {
    warn("outOfRangePitch", beat.measureId);
    return;
  }
  if (bend && !supports(midi + bend)) {
    warn("outOfRangePitch", beat.measureId);
    bend = 0;
    tags.splice(tags.indexOf("bend"), 1);
  }
  if (auxiliaryMidi !== undefined && (!supports(auxiliaryMidi + bend) || auxiliaryMidi === midi)) {
    if (!supports(auxiliaryMidi + bend)) warn("outOfRangePitch", beat.measureId);
    auxiliaryMidi = undefined;
    tags.splice(tags.indexOf("trill"), 1);
  }
  return { noteId, string, midi, endMidi: midi + bend, auxiliaryMidi, tags, offset: 0 };
}

function tonesAtBeat(
  beat: TimedBeat,
  techniques: PlaybackTechniqueIndex,
  resolve: (note: Pick<ILXMNote, "string" | "fret">, id: string | null) => Tone | undefined,
  ticksPerSecond: number,
  warn: Warn,
) {
  const traversals = techniques.traversals.get(beat.beatId) ?? [];
  const traversal = traversals[0];
  if (traversals.length > 1) warn("conflictingTechnique", beat.measureId);
  const tones: Tone[] = [];
  for (const note of beat.beat.notes) {
    const tone = resolve(note, note.id);
    if (tone) tones.push(tone);
  }
  if (!traversal) return tones;

  if (usesChordVoicingForTraversal(beat.beat)) {
    for (let string = traversal.minString; string <= traversal.maxString; string++) {
      const tone = resolve({ string, fret: "x" }, null);
      if (tone) tones.push(tone);
    }
  }
  const spread = tones.filter(({ string }) => string >= traversal.minString && string <= traversal.maxString);
  const duration = beat.endTick - beat.startTick;
  if (traversal.type === "strum") {
    const direction = traversal.stroke === "down" ? -1 : 1;
    spread.sort((a, b) => direction * (a.string - b.string));
  } else {
    const direction = traversal.direction === "ascending" ? 1 : -1;
    spread.sort((a, b) => direction * (a.midi - b.midi) || a.string - b.string);
  }

  const spacing = fitTicks(traversal.type === "strum" ? 0.012 : 0.043, ticksPerSecond);
  const span = Math.min(spacing * (spread.length - 1), Math.floor(duration * 0.65));
  for (const [index, tone] of spread.entries()) {
    tone.offset = spread.length === 1 ? 0 : Math.round(span * index / (spread.length - 1));
    tone.tags.push(traversal.type);
  }
  return tones.sort((a, b) => a.offset - b.offset || a.string - b.string);
}

function makeEnvelope(tone: Tone, attack: PlaybackSound["attack"], pick: ILXMStrokeDirection | null): PlaybackEnvelope {
  const harmonic = tone.tags.some((tag) => tag === "naturalHarmonic" || tag === "artificialHarmonic");
  const envelope: PlaybackEnvelope = {
    gain: harmonic ? 0.72 : 0.85,
    attackSeconds: harmonic ? 0.009 : 0.003,
    sampleOffsetSeconds: harmonic ? 0.009 : 0,
    releaseSeconds: 0.024,
    lowpassHz: null,
    highpassHz: harmonic ? 380 : null,
    decaySeconds: null,
  };
  switch (attack) {
    case "hammerOn": return { ...envelope, gain: 0.7, attackSeconds: 0.01, sampleOffsetSeconds: 0.021, lowpassHz: 6200 };
    case "pullOff": return { ...envelope, gain: 0.73, attackSeconds: 0.007, sampleOffsetSeconds: 0.014, lowpassHz: 7200 };
    case "tapping": return { ...envelope, gain: 0.68, attackSeconds: 0.004, sampleOffsetSeconds: 0.025, lowpassHz: 5400 };
    case "pluck":
      if (pick === "down") return { ...envelope, gain: envelope.gain, attackSeconds: envelope.attackSeconds * 0.85, lowpassHz: 11000 };
      if (pick === "up") return { ...envelope, gain: envelope.gain * 0.9, attackSeconds: envelope.attackSeconds * 1.45, lowpassHz: 7800 };
      return envelope;
  }
}

const palmMuted = (envelope: PlaybackEnvelope): PlaybackEnvelope => ({
  ...envelope,
  lowpassHz: 1800,
  decaySeconds: 0.09,
  releaseSeconds: 0.018,
});

function tagVoice(voice: Voice, ...tags: ILXMTechniqueType[]) {
  for (const tag of tags) if (!voice.techniques.includes(tag)) voice.techniques.push(tag);
}

function muteVoice(voice: Voice, mutedBeats: readonly TimedBeat[]) {
  let lower = 0;
  let upper = mutedBeats.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (mutedBeats[middle]!.endTick <= voice.startTick) lower = middle + 1;
    else upper = middle;
  }
  const beat = mutedBeats[lower];
  if (!beat || beat.startTick >= voice.endTick) return;

  const offsetTicks = Math.max(0, beat.startTick - voice.sourceStartTick);
  if (offsetTicks === 0) voice.envelope = palmMuted(voice.envelope);
  const changes = voice.envelopeChanges;
  const changeIndex = changes.findIndex((change) => change.offsetTicks >= offsetTicks);
  const index = changeIndex < 0 ? changes.length : changeIndex;
  if (offsetTicks > 0 && changes[index]?.offsetTicks !== offsetTicks) {
    changes.splice(index, 0, { offsetTicks, envelope: changes[index - 1]?.envelope ?? voice.envelope });
  }
  for (let i = index; i < changes.length; i++) {
    const change = changes[i]!;
    changes[i] = { ...change, envelope: palmMuted(change.envelope) };
  }
  tagVoice(voice, "palmMute");
}

function setPitch(voice: Voice, tick: number, midi: number, interpolation: PlaybackPitchPoint["interpolation"]) {
  const offsetTicks = tick - voice.sourceStartTick;
  const semitones = midi - voice.midi;
  const previous = voice.pitch.at(-1);
  if (previous?.offsetTicks === offsetTicks && previous.semitones === semitones) return;
  voice.pitch.push({ offsetTicks, semitones, interpolation });
}

function applyPitchEffects(voice: Voice, tone: Tone, start: number, end: number, ticksPerSecond: number) {
  // A tied note without a pitch effect inherits the preceding part of the same voice.
  if (start === voice.sourceStartTick || tone.endMidi !== tone.midi || tone.auxiliaryMidi !== undefined)
    setPitch(voice, start, tone.midi, "step");

  const duration = end - start;
  const bend = tone.endMidi - tone.midi;
  const bendTicks = Math.max(1, Math.min(Math.floor(duration * 0.55), fitTicks(0.24, ticksPerSecond)));
  const trillTicks = Math.max(1, Math.min(Math.floor(duration / 2), fitTicks(0.078, ticksPerSecond)));
  let auxiliary = false;
  const offsets = new Set<number>();
  if (bend) offsets.add(bendTicks);
  if (tone.auxiliaryMidi !== undefined) {
    for (let tick = trillTicks; tick < duration; tick += trillTicks) offsets.add(tick);
  }
  for (const offset of [...offsets].sort((a, b) => a - b)) {
    const shifted = bend * Math.min(1, offset / bendTicks);
    if (bend && offset <= bendTicks)
      setPitch(voice, start + offset, (auxiliary ? tone.auxiliaryMidi! : tone.midi) + shifted, "linear");
    if (tone.auxiliaryMidi !== undefined && offset % trillTicks === 0 && offset < duration) {
      auxiliary = !auxiliary;
      setPitch(voice, start + offset, (auxiliary ? tone.auxiliaryMidi : tone.midi) + shifted, "step");
    }
  }
  if (bend || tone.auxiliaryMidi !== undefined)
    voice.targetMidi = bend ? tone.endMidi : tone.auxiliaryMidi!;
  if (tone.tags.includes("vibrato")) {
    voice.vibrato.push({
      startOffsetTicks: start - voice.sourceStartTick + Math.floor(duration * 0.2),
      endOffsetTicks: end - voice.sourceStartTick,
      frequencyHz: 5.4,
      depthSemitones: 0.22,
    });
  }
}

function attachSlide(voice: Voice, to: Tone, targetTick: number, ticksPerSecond: number) {
  const previousTick = voice.sourceStartTick + voice.pitch.at(-1)!.offsetTicks;
  const rampStart = Math.min(targetTick - 1, Math.max(previousTick, targetTick - fitTicks(0.095, ticksPerSecond)));
  const fromMidi = voice.midi + voice.pitch.at(-1)!.semitones;
  setPitch(voice, rampStart, fromMidi, "step");
  setPitch(voice, targetTick, to.midi, "linear");
  voice.targetMidi = to.midi;
}

function connect(
  beat: TimedBeat,
  tone: Tone,
  previous: Endpoint | undefined,
  seen: ReadonlySet<string>,
  techniques: PlaybackTechniqueIndex,
  warn: Warn,
) {
  const kinds = new Set<ILXMTechniqueType>();
  const connections = tone.noteId === null ? [] : techniques.incoming.get(tone.noteId) ?? [];
  const directional = connections.filter(({ fromNoteId, type }) =>
    fromNoteId === previous?.tone?.noteId && type !== "tie",
  );
  const contradictory = directional.some(({ type }) => type === "hammerOn" || type === "slideUp") &&
    directional.some(({ type }) => type === "pullOff" || type === "slideDown");
  if (contradictory) warn("conflictingTechnique", beat.measureId);

  for (const connection of connections) {
    if (!seen.has(connection.fromNoteId)) continue;
    const from = previous?.tone;
    const validSource = from?.noteId === connection.fromNoteId && previous?.voice && from.string === tone.string;
    const delta = from ? tone.midi - from.midi : 0;
    const validPitch = connection.type === "tie" ? delta === 0 && previous?.beat.order === beat.order - 1
      : connection.type === "slideUp" || connection.type === "hammerOn" ? delta > 0 : delta < 0;
    if (validSource && validPitch) kinds.add(connection.type);
    else if (!contradictory || !directional.includes(connection) || !validSource || delta === 0)
      warn("invalidConnection", beat.measureId);
  }
  return {
    tie: kinds.has("tie"),
    slide: kinds.has("slideUp") ? "slideUp" as const : kinds.has("slideDown") ? "slideDown" as const : null,
    legato: kinds.has("hammerOn") ? "hammerOn" as const : kinds.has("pullOff") ? "pullOff" as const : null,
  };
}

function isTraversedTone(tone: Tone): boolean {
  return tone.tags.includes("strum") || tone.tags.includes("arpeggio");
}

function traversalTieSource(fromBeat: TimedBeat, previous: Endpoint | undefined, target: Tone): Voice | undefined {
  const { tone, voice } = previous ?? {};
  if (previous?.beat !== fromBeat || !tone || !voice || tone.midi !== target.midi) return undefined;
  if (!isTraversedTone(tone) || !isTraversedTone(target)) return undefined;
  const lastPitch = voice.midi + (voice.pitch.at(-1)?.semitones ?? 0);
  return lastPitch === target.midi ? voice : undefined;
}

function planRun(
  run: PlaybackRun,
  tuning: ReadonlyMap<number, number>,
  techniques: PlaybackTechniqueIndex,
  ticksPerSecond: number,
  supports: (midi: number) => boolean,
  warn: Warn,
): Voice[] {
  const voices: Voice[] = [];
  const active = new Map<number, Voice>();
  const seen = new Set<string>();
  let lastOnString = new Map<number, Endpoint>();
  const beatByOrder = new Map(run.beats.map((beat) => [beat.order, beat]));
  const mutedBeats: TimedBeat[] = [];
  let previousBeat: TimedBeat | undefined;

  for (const beat of run.beats) {
    const { startTick, endTick } = beat;
    const contiguousPreviousBeat = previousBeat?.endTick === startTick ? previousBeat : undefined;
    const pm = rangeAtOrder(techniques.palmMute, beat.order) !== undefined;
    const ring = rangeAtOrder(techniques.letRing, beat.order);
    if (pm && ring) warn("conflictingTechnique", beat.measureId);
    const ringEnd = ring && !pm ? beatByOrder.get(ring.end)?.endTick ?? run.endTick : endTick;
    const previousEndpoints = lastOnString;
    if (beat.beat.kind === "rest" || (previousBeat && !contiguousPreviousBeat)) lastOnString = new Map();
    if (pm) mutedBeats.push(beat);

    if (contiguousPreviousBeat) {
      const pure = isPureTabContinuationBeat(beat.beat);
      const continued = beat.beat.notes.filter((note) => note.fret === "-").map((note) => note.string);
      for (const [string, voice] of active) {
        const previous = previousEndpoints.get(string);
        const followsSound = contiguousPreviousBeat.beat.kind !== "rest" ||
          (previous?.beat === contiguousPreviousBeat && previous.voice === voice);
        if (followsSound && (pure || continued.includes(string)) && voice.endTick >= startTick) {
          if (ring && !pm) tagVoice(voice, "letRing");
          voice.endTick = Math.max(voice.endTick, ringEnd);
        }
      }
    }

    const resolve = (note: Pick<ILXMNote, "string" | "fret">, id: string | null) =>
      resolveTone(beat, note, id, tuning, techniques, supports, warn);
    const tones = tonesAtBeat(beat, techniques, resolve, ticksPerSecond, warn);
    const picks = techniques.picks.get(beat.beatId) ?? [];
    if (picks.length > 1) warn("conflictingTechnique", beat.measureId);
    const pick = tones.length === 1 ? picks[0]?.stroke ?? null : null;
    const onsets = new Set<string>();
    const traversalTieFrom = contiguousPreviousBeat && contiguousPreviousBeat.order === beat.order - 1 &&
      (usesChordVoicingForTraversal(contiguousPreviousBeat.beat) || usesChordVoicingForTraversal(beat.beat)) &&
      techniques.traversalTies.get(beat.beatId)?.some(({ fromBeatId }) => fromBeatId === contiguousPreviousBeat.beatId)
      ? contiguousPreviousBeat : undefined;

    for (const tone of tones) {
      const start = startTick + tone.offset;
      const previous = lastOnString.get(tone.string);
      const { tie, slide, legato } = connect(beat, tone, previous, seen, techniques, warn);
      const source = previous?.voice;
      const traversalSource = traversalTieFrom && traversalTieSource(traversalTieFrom, previousEndpoints.get(tone.string), tone);
      let voice: Voice;
      const connectedVoice = source && (tie || slide) ? source : traversalSource;
      if (connectedVoice) {
        voice = connectedVoice;
        voice.endTick = Math.max(voice.endTick, ringEnd);
        if (tie) tagVoice(voice, "tie");
        if (traversalSource) tagVoice(voice, "traversalTie");
        if (slide && !tie) {
          attachSlide(voice, tone, start, ticksPerSecond);
          tagVoice(voice, slide);
        }
        if (legato && slide) {
          voice.envelopeChanges.push({
            offsetTicks: start - voice.sourceStartTick,
            envelope: makeEnvelope(tone, legato, null),
          });
          tagVoice(voice, legato);
        }
      } else {
        const lastVoice = active.get(tone.string);
        if (lastVoice) lastVoice.endTick = legato && source === lastVoice ? start : Math.min(lastVoice.endTick, start);
        const attack = legato ?? (tone.tags.includes("tapping") ? "tapping" : "pluck");
        voice = {
          visitIndex: beat.visitIndex, measureId: beat.measureId, beatId: beat.beatId, noteId: tone.noteId,
          string: tone.string, midi: tone.midi, targetMidi: tone.midi,
          startTick: start, endTick: ringEnd, sourceStartTick: start, onsetOffsetTicks: tone.offset,
          attack, pickStroke: pick, techniques: [], pitch: [], vibrato: [],
          envelope: makeEnvelope(tone, attack, pick), envelopeChanges: [],
        };
        if (legato) tagVoice(voice, legato);
        if (pick) tagVoice(voice, "pickStroke");
        voices.push(voice);
        active.set(tone.string, voice);
      }
      if (ring && !pm) tagVoice(voice, "letRing");
      tagVoice(voice, ...tone.tags);
      applyPitchEffects(voice, tone, start, endTick, ticksPerSecond);
      const endpoint = { beat, tone, voice };
      lastOnString.set(tone.string, endpoint);
      if (tone.noteId !== null) onsets.add(tone.noteId);
    }

    for (const note of beat.beat.notes) {
      if (!onsets.has(note.id)) {
        lastOnString.set(note.string, { beat });
        if (techniques.incoming.get(note.id)?.some(({ fromNoteId }) => seen.has(fromNoteId)))
          warn("invalidConnection", beat.measureId);
      }
      seen.add(note.id);
    }
    previousBeat = beat;
  }
  for (const voice of voices) muteVoice(voice, mutedBeats);
  return voices;
}

export function buildPlaybackSounds(
  track: ILXMTrack,
  runs: readonly PlaybackRun[],
  ticksPerSecond: number,
  midiRange: readonly [number, number],
  warn: Warn,
): PlaybackSound[] {
  const tuning = new Map(track.tuning.strings.map(({ index, midi }) => [index, midi + track.capo]));
  const techniques = indexPlaybackTechniques(track);
  const supports = (midi: number) => Number.isInteger(midi) && midi >= midiRange[0] && midi <= midiRange[1];
  return runs.flatMap((run) => planRun(run, tuning, techniques, ticksPerSecond, supports, warn));
}
