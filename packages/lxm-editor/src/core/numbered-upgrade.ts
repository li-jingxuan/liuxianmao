import { z } from "zod";
import { LXMDocumentSchema as LegacyDocumentSchema } from "./legacy-document-schema";
import { CURRENT_SCHEMA_VERSION } from "./constants";
import type { ILXMDocument, ILXMNumberedEvent } from "./types";
type LegacyDocument = z.infer<typeof LegacyDocumentSchema>;
/** 确定性 ID 分配跳过旧实体，转换不改变调用方对象。 */
export const convertLegacyNumbered = (source: LegacyDocument): ILXMDocument => {
  const used = new Set<string>();
  const visited = new WeakSet<object>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object" || visited.has(v)) return;
    visited.add(v);
    if ("id" in v && typeof v.id === "string") used.add(v.id);
    Object.values(v).forEach(walk);
  };
  walk(source);
  let counter = 0;
  const id = (kind: string) => {
    let next = "";
    do {
      next = `numbered-${kind}-upgrade-${++counter}`;
    } while (used.has(next));
    used.add(next);
    return next;
  };
  return {
    ...source,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    score: {
      ...source.score,
      tracks: source.score.tracks.map((track) => ({
        ...track,
        numberedMarks: [],
        measures: track.measures.map((m) => {
          const selectedGroups = m.tuplets.filter((g) =>
            g.beatIds.some(
              (bid) => m.beats.find((b) => b.id === bid)?.numberedNotation,
            ),
          );
          const grouped = new Set(selectedGroups.flatMap((g) => g.beatIds));
          const eventByBeat = new Map<string, ILXMNumberedEvent>();
          const events = m.beats.flatMap((beat) => {
            const tokens = beat.numberedNotation?.tokens;
            if (!tokens && !grouped.has(beat.id)) return [];
            const event: ILXMNumberedEvent = tokens
              ? {
                  id: id("event"),
                  tick: beat.tick,
                  rhythm: { ...beat.rhythm },
                  kind:
                    tokens[0] === "0"
                      ? "rest"
                      : tokens[0] === "-"
                        ? "continuation"
                        : "notes",
                  items: tokens.map((token) => ({ id: id("item"), token })),
                }
              : {
                  id: id("event"),
                  tick: beat.tick,
                  rhythm: { ...beat.rhythm },
                  kind: "gap",
                  items: [],
                };
            eventByBeat.set(beat.id, event);
            return [event];
          });
          return {
            ...m,
            beats: m.beats.map(({ numberedNotation: _old, ...beat }) => beat),
            numberedVoice: {
              events,
              tuplets: selectedGroups.map((g) => ({
                id: id("tuplet"),
                eventIds: g.beatIds.map((bid) => eventByBeat.get(bid)!.id),
                ratio: { ...g.ratio },
              })),
            },
          };
        }),
      })),
    },
  };
};
