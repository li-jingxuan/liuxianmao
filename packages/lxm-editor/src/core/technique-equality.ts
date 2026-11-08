import type { ILXMTechniqueDraft } from "./types";

/** Compare only domain fields; IDs and property insertion order carry no musical meaning. */
export const sameTechniqueDraft = (
  left: ILXMTechniqueDraft,
  right: ILXMTechniqueDraft,
): boolean => {
  if (left.type !== right.type) return false;
  const fields = (() => {
    switch (left.type) {
      case "bend": return ["fromNoteId", "semitones"];
      case "trill": return ["fromNoteId", "auxiliaryFret"];
      case "hammerOn": case "pullOff": case "slideUp": case "slideDown": case "tie":
        return ["fromNoteId", "toNoteId"];
      case "strum": return ["beatId", "minString", "maxString", "stroke"];
      case "arpeggio": return ["beatId", "minString", "maxString", "direction"];
      case "pickStroke": return ["beatId", "stroke"];
      case "palmMute": case "letRing": return ["fromBeatId", "toBeatId"];
      default: return ["fromNoteId"];
    }
  })();
  const a = left as unknown as Record<string, unknown>;
  const b = right as unknown as Record<string, unknown>;
  return fields.every((field) => a[field] === b[field]);
};
