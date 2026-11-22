import type { ChordIdentity } from "../chords/chord-catalog";
import { TICKS_PER_QUARTER } from "../constants";
import type { ILXMChordString, ILXMDocument, ILXMStrokeDirection, ILXMTechniqueType, ILXMTrack } from "../types";
import { buildPlaybackSounds } from "./sound";
import { buildPlaybackTimeline } from "./timeline";

export const DEFAULT_PLAYBACK_BPM = 90;
export const MIN_PLAYBACK_BPM = 40;
export const MAX_PLAYBACK_BPM = 240;

export const playbackTicksToSeconds = (ticks: number, bpm: number): number =>
  ticks * 60 / (TICKS_PER_QUARTER * bpm);

export const playbackSecondsToTicks = (seconds: number, bpm: number): number =>
  seconds * TICKS_PER_QUARTER * bpm / 60;

export interface PlaybackChordCatalog {
  readonly tuningId: "guitar-standard";
  readonly items: readonly (Readonly<ChordIdentity> & {
    readonly defaultVoicingId: string;
    readonly voicings: readonly {
      readonly id: string;
      readonly diagram: { readonly strings: readonly Readonly<Pick<ILXMChordString, "string" | "fret">>[] };
    }[];
  })[];
}

export interface PlaybackPlanOptions {
  bpm?: number;
  startMeasureId?: string;
  /** A snapshot of the loaded standard-tuning catalog, which is never modified. */
  chordCatalog?: PlaybackChordCatalog | null;
  /** Inclusive base and target pitch limits. Defaults to MIDI 0–127. */
  midiRange?: readonly [min: number, max: number];
}

export interface PlaybackMeasureVisit {
  /** Zero-based index in the full expanded performance, stable when starting mid-score. */
  visitIndex: number;
  measureId: string;
  measureIndex: number;
  startTick: number;
  endTick: number;
  jumped: boolean;
}

export interface PlaybackBeat extends PlaybackMeasureVisit {
  beatId: string;
}

export interface PlaybackPitchPoint {
  /** Elapsed ticks from the original sound onset. */
  offsetTicks: number;
  /** Offset from the sound's base MIDI pitch. */
  semitones: number;
  /** Interpolation from the previous point. */
  interpolation: "step" | "linear";
}

export interface PlaybackVibrato {
  startOffsetTicks: number;
  endOffsetTicks: number;
  frequencyHz: number;
  depthSemitones: number;
}

export interface PlaybackEnvelope {
  gain: number;
  attackSeconds: number;
  sampleOffsetSeconds: number;
  releaseSeconds: number;
  lowpassHz: number | null;
  highpassHz: number | null;
  /** Optional additional decay, applied exponentially from the envelope change. */
  decaySeconds: number | null;
}

export interface PlaybackEnvelopeChange {
  offsetTicks: number;
  envelope: PlaybackEnvelope;
}

export interface PlaybackSound {
  visitIndex: number;
  measureId: string;
  beatId: string;
  noteId: string | null;
  string: number;
  midi: number;
  /** Final base pitch or effect target, before vibrato. */
  targetMidi: number;
  /** Actual onset in the selected plan, including the traversal offset or clipping at zero. */
  startTick: number;
  endTick: number;
  /** Original onset in the selected plan's clock. Can be negative for carried sound. */
  sourceStartTick: number;
  onsetOffsetTicks: number;
  attack: "pluck" | "hammerOn" | "pullOff" | "tapping";
  pickStroke: ILXMStrokeDirection | null;
  techniques: readonly ILXMTechniqueType[];
  pitch: readonly PlaybackPitchPoint[];
  vibrato: readonly PlaybackVibrato[];
  envelope: PlaybackEnvelope;
  envelopeChanges: readonly PlaybackEnvelopeChange[];
}

export type PlaybackWarningCode = "missingChordVoicing" | "outOfRangePitch" |
  "invalidRepeat" | "invalidConnection" | "approximateHarmonic" | "conflictingTechnique";

export interface PlaybackWarning {
  code: PlaybackWarningCode;
  measureIds: readonly string[];
}

export interface PlaybackPlan {
  bpm: number;
  durationTicks: number;
  visits: readonly PlaybackMeasureVisit[];
  beats: readonly PlaybackBeat[];
  sounds: readonly PlaybackSound[];
  warnings: readonly PlaybackWarning[];
}

/** Pure preview of a single guitar track, with no dependency on the audio runtime. */
export function createPlaybackPlan(
  source: ILXMDocument | ILXMTrack,
  options: PlaybackPlanOptions = {},
): PlaybackPlan {
  const track = "score" in source ? source.score.tracks[0] : source;
  const bpm = Number.isFinite(options.bpm)
    ? Math.max(MIN_PLAYBACK_BPM, Math.min(MAX_PLAYBACK_BPM, options.bpm!))
    : DEFAULT_PLAYBACK_BPM;
  if (!track) return { bpm, durationTicks: 0, visits: [], beats: [], sounds: [], warnings: [] };

  const warnings = new Map<PlaybackWarningCode, Set<string>>();
  const warn = (code: PlaybackWarningCode, measureId: string) => {
    const ids = warnings.get(code);
    if (ids) ids.add(measureId);
    else warnings.set(code, new Set([measureId]));
  };

  const timeline = buildPlaybackTimeline(track, options.chordCatalog, warn);
  const ticksPerSecond = playbackSecondsToTicks(1, bpm);
  const sounds = buildPlaybackSounds(track, timeline.runs, ticksPerSecond, options.midiRange ?? [0, 127], warn);
  const selected = timeline.visits.find((visit) => visit.measureId === options.startMeasureId);
  const origin = selected?.startTick ?? 0;
  const visits = timeline.visits.slice(selected?.visitIndex ?? 0).map((visit) => ({
    ...visit, startTick: visit.startTick - origin, endTick: visit.endTick - origin,
  }));
  const audibleMeasures = new Set(visits.map(({ measureId }) => measureId));
  const beats = timeline.runs.flatMap((run) => run.beats).filter((beat) => beat.startTick >= origin).map((beat) => ({
    visitIndex: beat.visitIndex,
    measureId: beat.measureId,
    measureIndex: beat.measureIndex,
    jumped: beat.jumped,
    beatId: beat.beatId,
    startTick: beat.startTick - origin,
    endTick: beat.endTick - origin,
  }));
  return {
    bpm,
    durationTicks: timeline.durationTicks - origin,
    visits,
    beats,
    sounds: sounds.filter(({ endTick, startTick }) => endTick > origin && endTick > startTick).map((sound) => ({
      ...sound,
      startTick: Math.max(0, sound.startTick - origin),
      endTick: sound.endTick - origin,
      sourceStartTick: sound.sourceStartTick - origin,
    })),
    warnings: [...warnings].flatMap(([code, ids]) => {
      const measureIds = track.measures.filter(({ id }) =>
        ids.has(id) && (code === "invalidRepeat" || audibleMeasures.has(id)),
      ).map(({ id }) => id);
      return measureIds.length ? [{ code, measureIds }] : [];
    }),
  };
}

/** Returns the active written beat at a playback position, including silent beats. */
export function getPlaybackBeatAtTick(plan: PlaybackPlan, tick: number): PlaybackBeat | undefined {
  let lower = 0;
  let upper = plan.beats.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (plan.beats[middle]!.endTick <= tick) lower = middle + 1;
    else upper = middle;
  }
  const beat = plan.beats[lower];
  return beat && beat.startTick <= tick ? beat : undefined;
}
