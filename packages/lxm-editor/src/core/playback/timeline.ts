import { parseChordCatalogName } from "../chords/chord-catalog";
import { STANDARD_GUITAR_TUNING } from "../constants";
import { getMeasureCapacityTicks } from "../rhythm/rhythm";
import { createMeasureRhythmContext } from "../rhythm/tuplet";
import type { ILXMBeat, ILXMChordSymbol, ILXMTrack } from "../types";
import type { PlaybackBeat, PlaybackMeasureVisit, PlaybackPlanOptions, PlaybackWarningCode } from "./plan";

export type Warn = (code: PlaybackWarningCode, measureId: string) => void;

export interface TimedBeat extends PlaybackBeat {
  beat: ILXMBeat;
  frets: ReadonlyMap<number, number | "x"> | undefined;
  order: number;
}

export interface PlaybackRun {
  beats: TimedBeat[];
  endTick: number;
}

function repeatOrder(track: ILXMTrack, warn: Warn): number[] {
  const { measures } = track;
  const written = measures.map((_, index) => index);
  const repeats = new Map<number, number>();
  let openStart = track.startBarline === "repeatStart" ? 0 : undefined;
  let lastEnd = -1;
  let invalid = false;

  for (const [index, { barline, id }] of measures.entries()) {
    if (barline === "repeatEnd" || barline === "repeatBoth") {
      const start = openStart ?? 0;
      if (start <= lastEnd || start > index) {
        warn("invalidRepeat", id);
        invalid = true;
      } else {
        repeats.set(index, start);
        lastEnd = index;
      }
      openStart = undefined;
    }
    if (barline === "repeatStart" || barline === "repeatBoth") {
      if (openStart !== undefined) {
        warn("invalidRepeat", id);
        invalid = true;
      }
      openStart = index + 1;
    }
  }

  if (invalid) return written;
  const expanded: number[] = [];
  for (const index of written) {
    expanded.push(index);
    const start = repeats.get(index);
    if (start === undefined) continue;
    // Disjoint sections give a strict upper bound of two visits per measure.
    for (let repeat = start; repeat <= index; repeat++) expanded.push(repeat);
  }
  return expanded;
}

function chordFrets(track: ILXMTrack, catalog: PlaybackPlanOptions["chordCatalog"]) {
  const standard = track.tuning.strings.length === STANDARD_GUITAR_TUNING.length &&
    STANDARD_GUITAR_TUNING.every(({ index, midi }) =>
      track.tuning.strings.some((string) => string.index === index && string.midi === midi),
    );
  const defaults = new Map<string, NonNullable<TimedBeat["frets"]>>();
  if (standard && catalog?.tuningId === "guitar-standard") {
    for (const item of catalog.items) {
      const voicing = item.voicings.find(({ id }) => id === item.defaultVoicingId);
      if (voicing) defaults.set(`${item.rootPc}:${item.quality}`, new Map(
        voicing.diagram.strings.map(({ string, fret }) => [string, fret]),
      ));
    }
  }

  return (symbol: ILXMChordSymbol) => {
    const { diagram, name } = symbol.chord;
    if (diagram) return new Map(diagram.strings.map(({ string, fret }) => [string, fret]));
    const chord = parseChordCatalogName(name);
    return chord ? defaults.get(`${chord.rootPc}:${chord.quality}`) : undefined;
  };
}

export function buildPlaybackTimeline(
  track: ILXMTrack,
  catalog: PlaybackPlanOptions["chordCatalog"],
  warn: Warn,
) {
  const readFrets = chordFrets(track, catalog);
  let frets: TimedBeat["frets"];
  let order = 0;
  const written = track.measures.map((measure) => {
    const rhythm = createMeasureRhythmContext(measure);
    const chords = new Map(measure.chordSymbols.map((symbol) => [symbol.beatId, symbol]));
    const beats = measure.beats.map((beat) => {
      const chord = chords.get(beat.id);
      if (chord) frets = readFrets(chord);
      const duration = rhythm.getBeatDurationTicks(beat);
      return { beat, frets, order: order++, duration: duration.ok ? duration.ticks : 0 };
    });
    return { beats, capacity: getMeasureCapacityTicks(measure.timeSignature) };
  });

  const visits: PlaybackMeasureVisit[] = [];
  const runs: PlaybackRun[] = [];
  let run: PlaybackRun | undefined;
  let tick = 0;
  for (const measureIndex of repeatOrder(track, warn)) {
    const visitIndex = visits.length;
    const jumped = visitIndex > 0 && visits[visitIndex - 1]!.measureIndex + 1 !== measureIndex;
    const { capacity, beats } = written[measureIndex]!;
    const visit = {
      visitIndex, measureIndex, jumped,
      measureId: track.measures[measureIndex]!.id,
      startTick: tick,
      endTick: tick + capacity,
    };
    visits.push(visit);
    if (!run || jumped) {
      run = { beats: [], endTick: tick };
      runs.push(run);
    }
    for (const { beat, frets, order, duration } of beats) {
      const startTick = tick + beat.tick;
      const endTick = Math.min(startTick + duration, visit.endTick);
      if (endTick > startTick)
        run.beats.push({ ...visit, beat, beatId: beat.id, frets, order, startTick, endTick });
    }
    tick = visit.endTick;
    run.endTick = tick;
  }
  return { visits, runs, durationTicks: tick };
}
