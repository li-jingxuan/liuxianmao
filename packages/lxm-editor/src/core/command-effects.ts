import type { ILXMScoreCommand } from "./commands";
import type {
  ILXMDocument,
  ILXMTechniqueType,
  ILXMNumberedMark,
  ILXMTupletRatio,
  ILXMTrack,
} from "./types";
import { createMeasureRhythmContext } from "./tuplet";
import { createNumberedRhythmContext } from "./numbered-rhythm";

interface EffectLocation {
  trackId: string;
  measureId: string;
  measureNumber: number;
}
/** 编辑影响只随命令结果返回，不进入 document 或历史快照。 */
export type ILXMCommandEffect =
  | (EffectLocation & { kind: "numbered.event.overwritten"; eventId: string })
  | (EffectLocation & {
      kind: "numbered.event.retimed" | "numbered.event.resized";
      eventId: string;
      beforeValue: number;
      afterValue: number;
    })
  | (EffectLocation & {
      kind:
        | "numbered.mark.removed"
        | "numbered.mark.migrated"
        | "numbered.mark.omitted";
      markId: string;
      markType?: ILXMNumberedMark["type"];
    })
  | (EffectLocation & {
      kind: "beats.structured";
      operation: "split" | "merge";
      consumedTieCount: number;
    })
  | (EffectLocation & {
      kind: "beats.pasted";
      mode: "insert" | "overwrite";
      count: number;
    })
  | (EffectLocation & {
      kind: "tuplets.structured";
      operation: "set" | "remove";
      ratio: ILXMTupletRatio;
      count: number;
    })
  | (EffectLocation & {
      kind: "measures.copied";
      endMeasureNumber: number;
      afterMeasureNumber: number;
      count: number;
    })
  | (EffectLocation & {
      kind: "beat.compressed";
      beatId: string;
      beatNumber: number;
      beforeTicks: number;
      afterTicks: number;
    })
  | (EffectLocation & {
      kind: "beat.retimed";
      beatId: string;
      beatNumber: number;
      beforeTick: number;
      afterTick: number;
    })
  | (EffectLocation & {
      kind: "technique.removed" | "technique.omitted";
      techniqueId: string;
      techniqueType: ILXMTechniqueType;
    });

/** 关系位置使用编辑前的端点，删除整个小节时仍能说明发生在哪里。 */
const numberedMarkLocation = (track: ILXMTrack, mark: ILXMNumberedMark) => {
  const measureIndex = track.measures.findIndex((m) =>
    m.numberedVoice.events.some((e) =>
      mark.type === "tie"
        ? e.items.some((i) => i.id === mark.fromItemId)
        : e.id === (mark.type === "slur" ? mark.fromEventId : mark.eventId),
    ),
  );
  const measure = track.measures[measureIndex];
  return measure
    ? {
        trackId: track.id,
        measureId: measure.id,
        measureNumber: measureIndex + 1,
      }
    : null;
};

/** 剪贴板只记录越界关系 ID；源仍存在时补齐类型与原位置，否则使用当前复制/粘贴范围。 */
/** 复制整小节时报告未能完整映射的简谱连接，位置使用源 mark 起点。 */
export const collectNumberedMarkOmissionEffects = (
  document: ILXMDocument,
  trackId: string,
  fallbackMeasureId: string,
  marks: readonly ILXMNumberedMark[],
): ILXMCommandEffect[] => {
  const track = document.score.tracks.find((item) => item.id === trackId);
  if (!track) return [];
  const fallback = {
    trackId,
    measureId: fallbackMeasureId,
    measureNumber: Math.max(
      1,
      track.measures.findIndex((m) => m.id === fallbackMeasureId) + 1,
    ),
  };
  return marks.map((mark) => ({
    ...(numberedMarkLocation(track, mark) ?? fallback),
    kind: "numbered.mark.omitted" as const,
    markId: mark.id,
    markType: mark.type,
  }));
};

export const collectNumberedOmissionEffects = (
  document: ILXMDocument,
  trackId: string,
  measureId: string,
  markIds: readonly string[],
): ILXMCommandEffect[] => {
  const track = document.score.tracks.find((t) => t.id === trackId);
  if (!track) return [];
  const fallback = {
    trackId,
    measureId,
    measureNumber: Math.max(
      1,
      track.measures.findIndex((m) => m.id === measureId) + 1,
    ),
  };
  return markIds.map((markId) => {
    const mark = track.numberedMarks.find((m) => m.id === markId);
    return {
      ...(mark ? (numberedMarkLocation(track, mark) ?? fallback) : fallback),
      kind: "numbered.mark.omitted",
      markId,
      ...(mark ? { markType: mark.type } : {}),
    };
  });
};

/** 比较稳定 ID 的前后状态，避免 UI 自行推测领域命令产生的连带变化。 */
export const collectCommandEffects = (
  before: ILXMDocument,
  after: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMCommandEffect[] => {
  const effects: ILXMCommandEffect[] = [];
  before.score.tracks.forEach((track) => {
    const nextTrack = after.score.tracks.find((item) => item.id === track.id);
    // 两谱各自比较稳定身份；简谱变化不从 TAB Beat 的变化反推。
    track.measures.forEach((measure, measureIndex) => {
      const nextMeasure = nextTrack?.measures.find((m) => m.id === measure.id);
      if (!nextMeasure || nextMeasure === measure) return;
      if (
        (command.type === "tuplet.set" || command.type === "tuplet.remove") &&
        command.trackId === track.id &&
        command.measureId === measure.id
      ) {
        const beforeGroup =
          command.type === "tuplet.remove"
            ? measure.tuplets.find((group) => group.id === command.tupletId)
            : undefined;
        const afterGroup =
          command.type === "tuplet.set"
            ? nextMeasure.tuplets.find(
                (group) =>
                  group.beatIds.includes(command.startBeatId) &&
                  group.beatIds.includes(command.endBeatId),
              )
            : undefined;
        const group = afterGroup ?? beforeGroup;
        if (group) {
          effects.push({
            trackId: track.id,
            measureId: measure.id,
            measureNumber: measureIndex + 1,
            kind: "tuplets.structured",
            operation: command.type === "tuplet.set" ? "set" : "remove",
            ratio: group.ratio,
            count: group.beatIds.length,
          });
        }
      }
      const previousContext = createNumberedRhythmContext(
        measure.numberedVoice,
      );
      const nextContext = createNumberedRhythmContext(
        nextMeasure.numberedVoice,
      );
      const nextEvents = new Map(
        nextMeasure.numberedVoice.events.map((e) => [e.id, e]),
      );
      const location = {
        trackId: track.id,
        measureId: measure.id,
        measureNumber: measureIndex + 1,
      };
      measure.numberedVoice.events.forEach((event) => {
        const nextEvent = nextEvents.get(event.id);
        if (!nextEvent) {
          if (
            command.type === "numbered.event.setRhythm" &&
            command.trackId === track.id &&
            command.measureId === measure.id
          )
            effects.push({
              ...location,
              kind: "numbered.event.overwritten",
              eventId: event.id,
            });
          return;
        }
        if (event.tick !== nextEvent.tick)
          effects.push({
            ...location,
            kind: "numbered.event.retimed",
            eventId: event.id,
            beforeValue: event.tick,
            afterValue: nextEvent.tick,
          });
        const previous = previousContext.getEventDurationTicks(event),
          next = nextContext.getEventDurationTicks(nextEvent);
        if (previous.ok && next.ok && previous.ticks !== next.ticks)
          effects.push({
            ...location,
            kind: "numbered.event.resized",
            eventId: event.id,
            beforeValue: previous.ticks,
            afterValue: next.ticks,
          });
      });
    });
    const nextMarks = new Map(
      nextTrack?.numberedMarks.map((m) => [m.id, m]) ?? [],
    );
    track.numberedMarks.forEach((mark) => {
      if (
        (command.type === "numbered.mark.remove" ||
          command.type === "numbered.mark.update") &&
        command.markId === mark.id
      )
        return;
      const nextMark = nextMarks.get(mark.id);
      const location = numberedMarkLocation(track, mark);
      if (
        !location ||
        (nextMark && JSON.stringify(mark) === JSON.stringify(nextMark))
      )
        return;
      effects.push({
        ...location,
        kind: nextMark ? "numbered.mark.migrated" : "numbered.mark.removed",
        markId: mark.id,
        markType: mark.type,
      });
    });
    if (!nextTrack || nextTrack === track) return;
    track.measures.forEach((measure, measureIndex) => {
      const nextMeasure = nextTrack.measures.find(
        (item) => item.id === measure.id,
      );
      if (!nextMeasure || nextMeasure === measure) return;
      const beforeContext = createMeasureRhythmContext(measure);
      const afterContext = createMeasureRhythmContext(nextMeasure);
      const location = {
        trackId: track.id,
        measureId: measure.id,
        measureNumber: measureIndex + 1,
      };
      measure.beats.forEach((beat, beatIndex) => {
        const nextBeat = nextMeasure.beats.find((item) => item.id === beat.id);
        if (!nextBeat) return;
        const beatLocation = {
          ...location,
          beatId: beat.id,
          beatNumber: beatIndex + 1,
        };
        const previousDuration = beforeContext.getBeatDurationTicks(beat);
        const nextDuration = afterContext.getBeatDurationTicks(nextBeat);
        const isRequestedRhythm =
          (command.type === "beat.setRhythm" ||
            command.type === "beat.split") &&
          command.trackId === track.id &&
          command.measureId === measure.id &&
          command.beatId === beat.id;
        if (
          !isRequestedRhythm &&
          previousDuration.ok &&
          nextDuration.ok &&
          nextDuration.ticks < previousDuration.ticks
        )
          effects.push({
            ...beatLocation,
            kind: "beat.compressed",
            beforeTicks: previousDuration.ticks,
            afterTicks: nextDuration.ticks,
          });
        if (beat.tick !== nextBeat.tick)
          effects.push({
            ...beatLocation,
            kind: "beat.retimed",
            beforeTick: beat.tick,
            afterTick: nextBeat.tick,
          });
      });
    });
    const remaining = new Set(
      nextTrack.techniques.map((technique) => technique.id),
    );
    track.techniques.forEach((technique) => {
      if (
        remaining.has(technique.id) ||
        (command.type === "beat.mergeRange" &&
          technique.type === "tie" &&
          !after.score.tracks
            .flatMap((t) =>
              t.measures.flatMap((m) => m.beats.flatMap((b) => b.notes)),
            )
            .some((n) => n.id === technique.toNoteId)) ||
        (command.type === "technique.remove" &&
          command.techniqueId === technique.id)
      )
        return;
      // 位置信息基于编辑前文档，删除小节造成的关系清理也必须可解释。
      const measureIndex = track.measures.findIndex((measure) =>
        measure.beats.some((beat) =>
          "fromNoteId" in technique
            ? beat.notes.some((note) => note.id === technique.fromNoteId)
            : "beatId" in technique
              ? beat.id === technique.beatId
              : beat.id === technique.fromBeatId,
        ),
      );
      const measure = track.measures[measureIndex];
      if (measure)
        effects.push({
          kind: "technique.removed",
          trackId: track.id,
          measureId: measure.id,
          measureNumber: measureIndex + 1,
          techniqueId: technique.id,
          techniqueType: technique.type,
        });
    });
  });
  if (command.type === "numbered.range.paste")
    effects.push(
      ...collectNumberedOmissionEffects(
        before,
        command.trackId,
        command.measureId,
        command.clipboard.omissions,
      ),
    );
  return effects;
};
