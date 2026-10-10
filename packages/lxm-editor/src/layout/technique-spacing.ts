/** 技巧的横向占位在断行前确定，与最终模板共用文字和图元尺寸。 */
import type { ILXMFret, ILXMNote, ILXMTrack } from "../core/types";
import {
  LXM_FRET_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_HALO_WIDTH,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_FRET_GAP_X,
  LXM_TECHNIQUE_TEXT_FONT_SIZE,
} from "./layout-constants";
import { getTextBounds } from "./technique-geometry";

export const TECHNIQUE_WAVE_MIN_WIDTH = 12;
export const TECHNIQUE_WAVE_MAX_WIDTH = 20;
/** 推弦与叠加揉弦共用抬升高度，紧凑调整不能使二者终点错位。 */
export const TECHNIQUE_BEND_RISE = 12;
export const TECHNIQUE_BEND_RUN = 10;
export const TECHNIQUE_LABEL_GAP = 3;

/** 推弦叠加揉弦时从 Full 的右侧展开，避免把整段揉弦抬到标签上方。 */
export const vibratoStartOffset = (half: number, hasBend: boolean): number =>
  half +
  LXM_TECHNIQUE_FRET_GAP_X +
  (hasBend ? TECHNIQUE_BEND_RUN + techniqueLabelWidth("Full") / 2 + 6 : 0);

export interface TechniqueInsets {
  left: number;
  right: number;
}

/** 统一使用完整字形与白色描边，不能把两位品位当作固定 6px 半宽。 */
export const fretHalfWidth = (fret: ILXMFret, natural = false): number =>
  getTextBounds(
    {
      text: natural ? `<${fret}>` : String(fret),
      x: 0,
      y: 0,
      fontSize: LXM_FRET_TEXT_FONT_SIZE,
      textAnchor: "middle",
    },
    LXM_FRET_TEXT_HALO_WIDTH,
  ).width / 2;

export const techniqueLabelWidth = (label: string): number =>
  getTextBounds({
    text: label,
    x: 0,
    y: 0,
    fontSize: LXM_TECHNIQUE_TEXT_FONT_SIZE,
    textAnchor: "start",
  }).width;

/** 范围内有 x 时，将扫弦/琶音放在字形左侧，尺寸与断行占位共用。 */
export const chordTraversalOffset = (
  notes: readonly Pick<ILXMNote, "string" | "fret">[],
  minString: number,
  maxString: number,
): number =>
  notes.some(
    (note) =>
      note.fret === "x" && note.string >= minString && note.string <= maxString,
  )
    ? fretHalfWidth("x") +
      LXM_TECHNIQUE_FRET_GAP_X +
      LXM_TECHNIQUE_ARROW_WIDTH / 2 +
      2
    : 0;

/** 多个同拍技巧取最严格占位，避免叠加宽度造成不必要的稀疏排版。 */
export const buildTechniqueInsets = (
  track: ILXMTrack,
): ReadonlyMap<string, TechniqueInsets> => {
  const beats = new Map(
    track.measures.flatMap((measure) =>
      measure.beats.map((beat) => [beat.id, beat]),
    ),
  );
  const notes = new Map(
    track.measures.flatMap((m) =>
      m.beats.flatMap((b) =>
        b.notes.map((n) => [n.id, { note: n, beatId: b.id }] as const),
      ),
    ),
  );
  const naturalNotes = new Set(
    track.techniques.flatMap((t) =>
      t.type === "naturalHarmonic" ? [t.fromNoteId] : [],
    ),
  );
  const result = new Map<string, TechniqueInsets>();
  const bendNotes = new Set(
    track.techniques.flatMap((t) => (t.type === "bend" ? [t.fromNoteId] : [])),
  );
  const reserve = (beatId: string, left: number, right: number) => {
    const old = result.get(beatId);
    result.set(beatId, {
      left: Math.max(old?.left ?? 0, left),
      right: Math.max(old?.right ?? 0, right),
    });
  };
  for (const t of track.techniques) {
    if ("fromBeatId" in t) {
      reserve(
        t.fromBeatId,
        0,
        techniqueLabelWidth(t.type === "palmMute" ? "P.M." : "let ring") +
          TECHNIQUE_LABEL_GAP +
          2,
      );
      continue;
    }
    if (t.type === "strum" || t.type === "arpeggio") {
      const offset = chordTraversalOffset(
        beats.get(t.beatId)?.notes ?? [],
        t.minString,
        t.maxString,
      );
      if (offset)
        reserve(
          t.beatId,
          offset + LXM_TECHNIQUE_ARROW_WIDTH / 2 + 1,
          fretHalfWidth("x"),
        );
      continue;
    }
    if (!("fromNoteId" in t)) continue;
    const target = notes.get(t.fromNoteId);
    if (!target) continue;
    const half = fretHalfWidth(
      target.note.fret,
      naturalNotes.has(target.note.id),
    );
    const start = half + LXM_TECHNIQUE_FRET_GAP_X;
    const markerRadius = Math.max(
      LXM_TECHNIQUE_ARROW_WIDTH,
      LXM_TECHNIQUE_ARROW_HEIGHT,
    );
    if (t.type === "bend")
      reserve(
        target.beatId,
        half,
        start +
          TECHNIQUE_BEND_RUN +
          Math.max(markerRadius, techniqueLabelWidth("Full") / 2) +
          1,
      );
    else if (t.type === "vibrato")
      reserve(
        target.beatId,
        half,
        vibratoStartOffset(half, bendNotes.has(t.fromNoteId)) +
          TECHNIQUE_WAVE_MIN_WIDTH +
          1,
      );
    else if (t.type === "trill")
      reserve(
        target.beatId,
        half,
        techniqueLabelWidth(`tr ${t.auxiliaryFret}`) +
          TECHNIQUE_LABEL_GAP +
          TECHNIQUE_WAVE_MIN_WIDTH +
          1,
      );
    else if (t.type === "naturalHarmonic") reserve(target.beatId, half, half);
    else if (t.type === "artificialHarmonic")
      reserve(
        target.beatId,
        Math.max(half, techniqueLabelWidth("A.H.") / 2),
        Math.max(half, techniqueLabelWidth("A.H.") / 2),
      );
    else if (t.type === "slideUp" || t.type === "slideDown") {
      reserve(target.beatId, half, start + 8);
      const end = notes.get(t.toNoteId);
      if (end) {
        const endHalf = fretHalfWidth(
          end.note.fret,
          naturalNotes.has(end.note.id),
        );
        reserve(end.beatId, endHalf, endHalf);
      }
    }
  }
  return result;
};
