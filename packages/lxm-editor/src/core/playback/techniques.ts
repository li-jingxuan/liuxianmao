import type { ILXMTechnique, ILXMTrack } from "../types";
import { buildTechniqueIndex } from "../techniques/technique-rules";

export type SingleNoteEffect = Extract<ILXMTechnique, { fromNoteId: string; toNoteId?: never }>;
export type Connection = Extract<ILXMTechnique, { toNoteId: string }>;
export type Traversal = Extract<ILXMTechnique, { minString: number }>;
type TraversalTie = Extract<ILXMTechnique, { type: "traversalTie" }>;
type Pick = Extract<ILXMTechnique, { type: "pickStroke" }>;
type Range = { start: number; end: number };

function add<T>(map: Map<string, T[]>, id: string, item: T) {
  const existing = map.get(id);
  if (existing) existing.push(item);
  else map.set(id, [item]);
}

function unionRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

export function indexPlaybackTechniques(track: ILXMTrack) {
  const index = buildTechniqueIndex(track);
  const single = new Map<string, SingleNoteEffect[]>();
  const incoming = new Map<string, Connection[]>();
  const traversals = new Map<string, Traversal[]>();
  const traversalTies = new Map<string, TraversalTie[]>();
  const picks = new Map<string, Pick[]>();
  const ranges = { palmMute: [] as Range[], letRing: [] as Range[] };

  for (const technique of track.techniques) {
    switch (technique.type) {
      case "bend":
      case "vibrato":
      case "naturalHarmonic":
      case "artificialHarmonic":
      case "tapping":
      case "trill":
        add(single, technique.fromNoteId, technique);
        break;
      case "hammerOn":
      case "pullOff":
      case "slideUp":
      case "slideDown":
      case "tie":
        add(incoming, technique.toNoteId, technique);
        break;
      case "strum":
      case "arpeggio":
        add(traversals, technique.beatId, technique);
        break;
      case "traversalTie":
        add(traversalTies, technique.toBeatId, technique);
        break;
      case "pickStroke":
        add(picks, technique.beatId, technique);
        break;
      case "palmMute":
      case "letRing": {
        const start = index.beatsById.get(technique.fromBeatId)?.order;
        const end = index.beatsById.get(technique.toBeatId)?.order;
        if (start !== undefined && end !== undefined && start <= end)
          ranges[technique.type].push({ start, end });
        break;
      }
      default: {
        const unhandled: never = technique;
        throw new Error(`Unhandled playback technique: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  return {
    single,
    incoming,
    traversals,
    traversalTies,
    picks,
    palmMute: unionRanges(ranges.palmMute),
    letRing: unionRanges(ranges.letRing),
  };
}

export type PlaybackTechniqueIndex = ReturnType<typeof indexPlaybackTechniques>;

export function rangeAtOrder(ranges: readonly Range[], order: number): Range | undefined {
  let lower = 0;
  let upper = ranges.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (ranges[middle]!.end < order) lower = middle + 1;
    else upper = middle;
  }
  const range = ranges[lower];
  return range && range.start <= order ? range : undefined;
}
