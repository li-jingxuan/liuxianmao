import { parseChordCatalogName } from "../chords/chord-catalog";
import { STANDARD_GUITAR_TUNING } from "../constants";
import { getMeasureDurationTicks } from "../rhythm/rhythm";
import { createMeasureRhythmContext } from "../rhythm/tuplet";
import type { ILXMBeat, ILXMChordSymbol, ILXMTrack } from "../types";
import type { PlaybackBeat, PlaybackMeasureVisit, PlaybackPlanOptions, PlaybackWarningCode } from "./plan";
import { resolvePlaybackReplay } from "./replay";
import { jumpPlaybackOrder } from "./jump-order";
import { isCapoJumpMark } from "./jump-marks";
import { collectRepeatEndingGroups, createRepeatEndingTraversal } from "./repeat-ending-order";

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

function collectRepeats(track: ILXMTrack, warn: Warn): ReadonlyMap<number, number> {
  const { measures } = track;
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

  return invalid ? new Map() : repeats;
}

function repeatOrder(track: ILXMTrack, repeats: ReadonlyMap<number, number>): number[] {
  const expanded: number[] = [];
  for (const index of track.measures.keys()) {
    expanded.push(index);
    const start = repeats.get(index);
    if (start === undefined) continue;
    // Disjoint sections give a strict upper bound of two visits per measure.
    for (let repeat = start; repeat <= index; repeat++) expanded.push(repeat);
  }
  return expanded;
}

function playbackOrder(track: ILXMTrack, repeats: ReadonlyMap<number, number>): number[] {
  const order = repeatOrder(track, repeats);
  if (!track.playbackReplay) return order;

  const replay = resolvePlaybackReplay(track.measures, track.playbackReplay);
  // 直接传入轨道的调用方可能跳过文件校验，失效引用时仍沿用常规试听顺序。
  if (!replay.ok) return order;

  const resume = order.lastIndexOf(replay.afterIndex) + 1;
  // 先完整展开反复线，再在锚点末次到访后插入闭区间。插入段只走书写顺序，
  // 即使与常规反复重叠也不再次触发反复线，走完从原顺序的下一项继续。
  const replayed = Array.from(
    { length: replay.throughIndex - replay.fromIndex + 1 },
    (_, offset) => replay.fromIndex + offset,
  );
  return [...order.slice(0, resume), ...replayed, ...order.slice(resume)];
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

  return ({ diagram, name }: ILXMChordSymbol["chord"]) => {
    if (diagram) return new Map(diagram.strings.map(({ string, fret }) => [string, fret]));
    const chord = parseChordCatalogName(name);
    return chord ? defaults.get(`${chord.rootPc}:${chord.quality}`) : undefined;
  };
}

export function buildPlaybackTimeline(
  track: ILXMTrack,
  catalog: PlaybackPlanOptions["chordCatalog"],
  warn: Warn,
  startMeasureId?: string,
) {
  const readFrets = chordFrets(track, catalog);
  let frets: TimedBeat["frets"];
  let order = 0;
  const written = track.measures.map((measure) => {
    const rhythm = createMeasureRhythmContext(measure);
    const chords = new Map(measure.chordSymbols.map((symbol) => [symbol.beatId, symbol]));
    // 重复快照只还原本节前缀。随后写在谱上的和弦照常生效并继续传给下一小节。
    const opening = measure.openingChordPlayback;
    let localFrets = opening === undefined ? frets : opening === null ? undefined : readFrets(opening);
    const beats = measure.beats.map((beat) => {
      const chord = chords.get(beat.id);
      if (chord) localFrets = frets = readFrets(chord.chord);
      const duration = rhythm.getBeatDurationTicks(beat);
      return { beat, frets: localFrets, order: order++, duration: duration.ok ? duration.ticks : 0 };
    });
    // 反复展开会多次访问同一个小节，每次访问都从它的实际结束位置接入下一小节。
    return { beats, capacity: getMeasureDurationTicks(measure) };
  });

  const visits: PlaybackMeasureVisit[] = [];
  const runs: PlaybackRun[] = [];
  let run: PlaybackRun | undefined;
  let tick = 0;
  const { repeats, groups } = collectRepeatEndingGroups(track, collectRepeats(track, warn));
  const hasMarks = track.measures.some((measure) => measure.jumpMarks?.length);
  const hasNewJumpKinds = track.measures.some((measure) => measure.jumpMarks?.some(({ kind }) =>
    isCapoJumpMark(kind) || kind === "fine" || kind === "dsAlFine",
  ));
  const buildRoute = (startIndex = 0) => {
    const endingRoute = groups.length ? createRepeatEndingTraversal(track, groups) : undefined;
    // 每条候选路线从第一遍起算；用于遍次标签的记录与路由到访一一对应。
    const route = jumpPlaybackOrder(track, repeats, startIndex, endingRoute?.atBoundary);
    const invalid = endingRoute?.invalidDestination;
    if (invalid) {
      // 路由逐节结束时检查边界，错误的目标仅用于检查，尚未展开为音符或游标到访。
      const repairMarkId = route.visits.at(-1)?.jump?.fromMarkId;
      return { route: {
        visits: route.visits.slice(0, -1),
        repeatEndingIssue: { ...invalid, ...(repairMarkId ? { repairMarkId } : {}) },
        issue: undefined,
        end: undefined,
      }, endingVisits: endingRoute?.visits };
    }
    return { route, endingVisits: endingRoute?.visits };
  };
  let performance = hasMarks || groups.length ? buildRoute() : undefined;
  if (performance && startMeasureId && groups.length === 0 && !hasNewJumpKinds) {
    const startIndex = track.measures.findIndex(({ id }) => id === startMeasureId);
    // 已到访小节由计划从完整路线裁剪。只有旧跳转谱沿用从未到访小节独立起播的兼容规则；
    // 新记号和显式组保留真实可达路线，试听侧栏可提示所选小节未到访。
    if (startIndex >= 0 && !performance.route.visits.some((visit) => visit.index === startIndex))
      performance = buildRoute(startIndex);
  }
  const { route, endingVisits } = performance ?? {};
  const traversal = route?.visits ?? playbackOrder(track, repeats).map((index) => ({ index, jump: undefined }));
  for (const { index: measureIndex, jump } of traversal) {
    const visitIndex = visits.length;
    const jumped = Boolean(jump) || (visitIndex > 0 && visits[visitIndex - 1]!.measureIndex + 1 !== measureIndex);
    const { capacity, beats } = written[measureIndex]!;
    const repeatEnding = endingVisits?.[visitIndex];
    const visit = {
      visitIndex, measureIndex, jumped,
      measureId: track.measures[measureIndex]!.id,
      startTick: tick,
      endTick: tick + capacity,
      ...(jump ? { jump } : {}),
      ...(repeatEnding ? { repeatEnding } : {}),
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
  return { visits, runs, durationTicks: tick, jumpIssue: route?.issue, jumpEnd: route?.end, repeatEndingIssue: route?.repeatEndingIssue };
}
