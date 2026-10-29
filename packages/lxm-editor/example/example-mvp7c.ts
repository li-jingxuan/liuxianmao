import source from "./example-technique-rhythm";
import type { ILXMDocument, ILXMTechnique } from "../src/core/types";
/** 以完整技巧谱为基准生成可重复验收谱，所有重复实体都重新命名。 */
export const createMvp7cExample = (measureCount = 14): ILXMDocument => {
  const d = structuredClone(source),
    track = d.score.tracks[0]!;
  d.score.id = `mvp7c-${measureCount}`;
  d.score.title =
    measureCount === 100
      ? "MVP7.1-C 100 小节基线谱"
      : "MVP7.1-C 简谱与拍点混合谱";
  d.score.arranger = "六线猫";
  d.score.keySignature = "C";
  const measures: typeof track.measures = [],
    techniques: ILXMTechnique[] = [];
  for (let offset = 0; offset < measureCount; offset += track.measures.length) {
    const sources = track.measures.slice(
      0,
      Math.min(track.measures.length, measureCount - offset),
    );
    const beats = new Map(
        sources.flatMap((m) =>
          m.beats.map((b) => [b.id, `${b.id}-c${offset}`] as const),
        ),
      ),
      notes = new Map(
        sources.flatMap((m) =>
          m.beats.flatMap((b) =>
            b.notes.map((n) => [n.id, `${n.id}-c${offset}`] as const),
          ),
        ),
      );
    for (const [mi, m] of sources.entries())
      measures.push({
        ...structuredClone(m),
        id: `${m.id}-c${offset}`,
        beats: m.beats.map((b, bi) => ({
          ...structuredClone(b),
          id: beats.get(b.id)!,
          notes: b.notes.map((n) => ({ ...n, id: notes.get(n.id)! })),
        })),
        lyrics: m.lyrics.map((l) => ({
          ...l,
          id: `${l.id}-c${offset}`,
          // 此谱例重新生成旋律；标签始终附在每小节首个 notes 事件。
          eventId: `${m.beats[0]!.id}-numbered-c${offset}`,
        })),
        chordSymbols: m.chordSymbols.map((c) => ({
          ...structuredClone(c),
          id: `${c.id}-c${offset}`,
          beatId: beats.get(c.beatId)!,
        })),
        numberedVoice: {
          events: m.beats.map((b, bi) => {
            const tokens =
              bi % 5 === 0
                ? ["#4'", "6..", "3"]
                : bi % 5 === 1
                  ? ["0"]
                  : bi % 5 === 2
                    ? ["-"]
                    : [String(((mi + bi) % 7) + 1)];
            return {
              id: `${b.id}-numbered-c${offset}`,
              tick: b.tick,
              rhythm: { ...b.rhythm },
              kind:
                tokens[0] === "0"
                  ? ("rest" as const)
                  : tokens[0] === "-"
                    ? ("continuation" as const)
                    : ("notes" as const),
              items: tokens.map((token, i) => ({
                id: `${b.id}-numbered-item-${i}-c${offset}`,
                token,
              })),
            };
          }),
          tuplets: m.tuplets.map((g) => ({
            id: `${g.id}-numbered-c${offset}`,
            ratio: { ...g.ratio },
            eventIds: g.beatIds.map((id) => `${id}-numbered-c${offset}`),
          })),
        },
        tuplets: m.tuplets.map((g) => ({
          ...structuredClone(g),
          id: `${g.id}-c${offset}`,
          beatIds: g.beatIds.map((id) => beats.get(id)!),
        })),
      });
    for (const t of track.techniques) {
      const id = `${t.id}-c${offset}`;
      if ("fromNoteId" in t) {
        if (
          !notes.has(t.fromNoteId) ||
          ("toNoteId" in t && !notes.has(t.toNoteId))
        )
          continue;
        techniques.push({
          ...t,
          id,
          fromNoteId: notes.get(t.fromNoteId)!,
          ...("toNoteId" in t ? { toNoteId: notes.get(t.toNoteId)! } : {}),
          ...(t.type === "bend" ? { semitones: 1 as const } : {}),
        } as ILXMTechnique);
      } else if ("beatId" in t) {
        if (beats.has(t.beatId))
          techniques.push({ ...t, id, beatId: beats.get(t.beatId)! });
      } else if (beats.has(t.fromBeatId) && beats.has(t.toBeatId))
        techniques.push({
          ...t,
          id,
          fromBeatId: beats.get(t.fromBeatId)!,
          toBeatId: beats.get(t.toBeatId)!,
        });
    }
  }
  track.measures = measures;
  track.techniques = techniques;
  return d;
};
export const EXAMPLE_MVP7C_DOCUMENT = createMvp7cExample();
export const EXAMPLE_MVP7C_LONG_DOCUMENT = createMvp7cExample(100);
