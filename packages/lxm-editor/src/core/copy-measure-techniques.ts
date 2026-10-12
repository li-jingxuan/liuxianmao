import type { ILXMIdFactory } from "./id-factory";
import type { ILXMMeasure, ILXMTechnique, ILXMTrack } from "./types";
import type { ILXMCommandEffect } from "./command-effects";

/** 只复制完全包含的技巧；跨边界关系不猜测新终点，并明确报告遗漏。 */
export const copyMeasureRangeTechniques = (
  track: ILXMTrack,
  sources: readonly ILXMMeasure[],
  copies: readonly ILXMMeasure[],
  factory: ILXMIdFactory,
): { techniques: ILXMTechnique[]; effects: ILXMCommandEffect[] } => {
  const source = sources[0]!;
  const sourceBeats = sources.flatMap((m) => m.beats);
  const copiedBeats = copies.flatMap((m) => m.beats);
  const beats = new Map(
    sourceBeats.map((beat, i) => [beat.id, copiedBeats[i]!.id]),
  );
  const notes = new Map(
    sourceBeats.flatMap((beat, i) =>
      beat.notes.map((note, j) => [note.id, copiedBeats[i]!.notes[j]!.id]),
    ),
  );
  const ordered = track.measures.flatMap((measure) =>
    [...measure.beats].sort((a, b) => a.tick - b.tick),
  );
  const order = new Map(ordered.map((beat, i) => [beat.id, i]));
  const noteBeat = new Map(
    ordered.flatMap((beat) => beat.notes.map((note) => [note.id, beat.id])),
  );
  const sourceOrders = sourceBeats.map((beat) => order.get(beat.id)!);
  const first = Math.min(...sourceOrders);
  const last = Math.max(...sourceOrders);
  const techniques: ILXMTechnique[] = [];
  const effects: ILXMCommandEffect[] = [];
  track.techniques.forEach((technique) => {
    const refs =
      "fromNoteId" in technique
        ? [
            technique.fromNoteId,
            ...("toNoteId" in technique ? [technique.toNoteId] : []),
          ]
        : "beatId" in technique
          ? [technique.beatId]
          : [technique.fromBeatId, technique.toBeatId];
    const map = "fromNoteId" in technique ? notes : beats;
    if (refs.every((id) => map.has(id))) {
      const id = factory.createTechniqueId();
      if ("fromNoteId" in technique)
        techniques.push({
          ...technique,
          id,
          fromNoteId: notes.get(technique.fromNoteId)!,
          ...("toNoteId" in technique
            ? { toNoteId: notes.get(technique.toNoteId)! }
            : {}),
        });
      else if ("beatId" in technique)
        techniques.push({
          ...technique,
          id,
          beatId: beats.get(technique.beatId)!,
        });
      else
        techniques.push({
          ...technique,
          id,
          fromBeatId: beats.get(technique.fromBeatId)!,
          toBeatId: beats.get(technique.toBeatId)!,
        });
      return;
    }
    // 区间两端都在小节外时仍可能贯穿当前小节，不能只检查端点归属。
    const positions = refs.map(
      (ref) => order.get("fromNoteId" in technique ? noteBeat.get(ref)! : ref)!,
    );
    if (Math.min(...positions) <= last && Math.max(...positions) >= first)
      effects.push({
        kind: "technique.omitted",
        trackId: track.id,
        measureId: source.id,
        measureNumber: track.measures.indexOf(source) + 1,
        techniqueId: technique.id,
        techniqueType: technique.type,
      });
  });
  return { techniques, effects };
};

/** 单小节复制复用范围算法，保留原有调用契约。 */
export const copyMeasureTechniques = (
  track: ILXMTrack,
  source: ILXMMeasure,
  copied: ILXMMeasure,
  factory: ILXMIdFactory,
) => copyMeasureRangeTechniques(track, [source], [copied], factory);
