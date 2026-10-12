import type { ILXMTrack } from "./types";
/** 将轨道级技巧引用投影为受保护 Beat，时间轴模块无需理解技巧类型。 */
export const techniqueBeatIds = (track: ILXMTrack): ReadonlySet<string> => {
  const notes = new Map(
    track.measures.flatMap((m) =>
      m.beats.flatMap((b) => b.notes.map((n) => [n.id, b.id] as const)),
    ),
  );
  return new Set(
    track.techniques
      .flatMap((t) =>
        "fromNoteId" in t
          ? [
              notes.get(t.fromNoteId)!,
              ...("toNoteId" in t ? [notes.get(t.toNoteId)!] : []),
            ]
          : "beatId" in t
            ? [t.beatId]
            : [t.fromBeatId, t.toBeatId],
      )
      .filter(Boolean),
  );
};
