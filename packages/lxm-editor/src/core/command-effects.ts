import type { ILXMScoreCommand } from "./commands";
import type { ILXMDocument, ILXMTechniqueType } from "./types";
import { createMeasureRhythmContext } from "./tuplet";

interface EffectLocation {
  trackId: string;
  measureId: string;
  measureNumber: number;
}
/** 编辑影响只随命令结果返回，不进入 document 或历史快照。 */
export type ILXMCommandEffect =
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

/** 比较稳定 ID 的前后状态，避免 UI 自行推测领域命令产生的连带变化。 */
export const collectCommandEffects = (
  before: ILXMDocument,
  after: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMCommandEffect[] => {
  const effects: ILXMCommandEffect[] = [];
  before.score.tracks.forEach((track) => {
    const nextTrack = after.score.tracks.find((item) => item.id === track.id);
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
          command.type === "beat.setRhythm" &&
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
  return effects;
};
