import {
  findNextNoteOnSameStringInTrack,
  resolveTabCellSelection,
  validateTechnique,
  LXMScoreCommandEnum as C,
  type ILXMDocument,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type ILXMTechniqueDraft,
  type ILXMTechniqueType,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";

export type QuickTechnique = "hammerOn" | "pullOff" | "slide" | "slideUp" | "slideDown" | "tie" | "strumDown" | "strumUp" | "arpeggioDown" | "arpeggioUp";
export type TechniqueIntent = { mode: "create"; type: "slide" | "arpeggio" };
export type TechniqueParameters = {
  direction: "down" | "up";
  semitones: 1 | 2;
  trillFret: number;
};
export const findTechniqueNote = (document: ILXMDocument, cell: ILXMTabCellReference) =>
  document.score.tracks.find((track) => track.id === cell.trackId)
    ?.measures.find((measure) => measure.id === cell.measureId)
    ?.beats.find((beat) => beat.id === cell.beatId)
    ?.notes.find((note) => note.string === cell.string) ?? null;

type TargetResult =
  | { ok: true; trackId: string; draft: ILXMTechniqueDraft }
  | { ok: false; message: string };
const fail = (message: string): TargetResult => ({ ok: false, message });

/** All entries share target translation. Core remains the final musical authority. */
export const resolveTechniqueDraft = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  type: ILXMTechniqueType,
  parameters: TechniqueParameters = { direction: "down", semitones: 2, trillFret: 7 },
  sameStringOnly = false,
): TargetResult => {
  if (!selection) return fail("请先选择 TAB 目标。");
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok) return fail(resolved.message);
  const track = document.score.tracks.find((item) => item.id === resolved.range.trackId);
  if (!track) return fail("技巧目标轨道不存在。");
  const focus = findTechniqueNote(document, selection.focus);
  const result = (draft: ILXMTechniqueDraft): TargetResult => ({ ok: true, trackId: track.id, draft });
  switch (type) {
    case "bend": case "trill": case "vibrato": case "naturalHarmonic": case "artificialHarmonic": case "tapping":
      if (!focus) return fail("该技巧需要 focus 单元格中已有品位音符。");
      if (focus.fret === "-") return fail("横线延音标记不能作为音符技巧的目标，请选择实际起音。");
      return result(type === "bend"
        ? { type, fromNoteId: focus.id, semitones: parameters.semitones }
        : type === "trill"
          ? { type, fromNoteId: focus.id, auxiliaryFret: parameters.trillFret }
          : { type, fromNoteId: focus.id });
    case "hammerOn": case "pullOff": case "slideUp": case "slideDown": case "tie": {
      if (sameStringOnly && selection.anchor.string !== selection.focus.string)
        return fail("请选择同一根弦上的音符。");
      // Sort complete cells, never recombine chronological beats with the opposite endpoint's string.
      const firstBeat = resolved.range.beats[0]!;
      const forward = selection.anchor.beatId === firstBeat.beatId;
      const firstCell = forward ? selection.anchor : selection.focus;
      const lastCell = forward ? selection.focus : selection.anchor;
      const from = findTechniqueNote(document, firstCell);
      if (!from) return fail("连接技巧的起始单元格必须已有品位音符。");
      const explicit = findTechniqueNote(document, lastCell);
      const to = explicit && explicit.id !== from.id
        ? explicit : findNextNoteOnSameStringInTrack(track, from.id)?.note;
      if (!to) return fail("没有找到可连接的同弦下一音，请调整选区。");
      if (from.fret === "-" || to.fret === "-")
        return fail("横线延音标记不能作为连接技巧的端点，请选择实际起音。");
      return result({ type, fromNoteId: from.id, toNoteId: to.id });
    }
    case "strum": case "arpeggio": {
      if (resolved.range.beats.length !== 1 || resolved.range.startString === resolved.range.endString)
        return fail("扫弦和琶音需要在同一 Beat 内选择至少两根弦线。");
      const target = {
        beatId: resolved.range.beats[0]!.beatId,
        minString: resolved.range.startString,
        maxString: resolved.range.endString,
      };
      return result(type === "strum"
        ? { type, ...target, stroke: parameters.direction }
        : { type, ...target, direction: parameters.direction === "down" ? "ascending" : "descending" });
    }
    case "pickStroke": return result({ type, beatId: selection.focus.beatId, stroke: parameters.direction });
    default: return result({ type, fromBeatId: resolved.range.beats[0]!.beatId, toBeatId: resolved.range.beats.at(-1)!.beatId });
  }
};

export const resolveQuickTechnique = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  quick: QuickTechnique,
): { ok: true; command: ILXMScoreCommand; pressed: boolean } | { ok: false; message: string } => {
  const strum = quick === "strumDown" || quick === "strumUp";
  const arpeggio = quick === "arpeggioDown" || quick === "arpeggioUp";
  const type = quick === "slide" ? "slideUp" : quick === "hammerOn" || quick === "pullOff" || quick === "slideUp" || quick === "slideDown" || quick === "tie"
    ? quick : strum ? "strum" : "arpeggio";
  const target = resolveTechniqueDraft(document, selection, type, {
    direction: quick === "strumUp" || quick === "arpeggioUp" ? "up" : "down", semitones: 2, trillFret: 7,
  }, !strum && !arpeggio);
  if (!target.ok) return target;
  const track = document.score.tracks.find((item) => item.id === target.trackId)!;
  const draft = target.draft;
  if (quick === "slide" && "fromNoteId" in draft && "toNoteId" in draft) {
    const notes = track.measures.flatMap((measure) => measure.beats.flatMap((beat) => beat.notes));
    const from = notes.find((note) => note.id === draft.fromNoteId)!;
    const to = notes.find((note) => note.id === draft.toNoteId)!;
    if (typeof from.fret === "number" && typeof to.fret === "number") {
      if (from.fret === to.fret) return { ok: false, message: "滑音需要两个不同品位的同弦音符。" };
      draft.type = to.fret > from.fret ? "slideUp" : "slideDown";
    }
  }
  const existing = draft.type === "strum" || draft.type === "arpeggio" ? track.techniques.find((item) =>
    (item.type === "strum" || item.type === "arpeggio") && item.beatId === draft.beatId) : undefined;
  const duplicate = track.techniques.find((item) => item.type === draft.type &&
    "fromNoteId" in item && "toNoteId" in item && "fromNoteId" in draft && "toNoteId" in draft &&
    item.fromNoteId === draft.fromNoteId && item.toNoteId === draft.toNoteId);
  const validity = validateTechnique(track, draft, existing?.id ?? duplicate?.id);
  if (!validity.ok) return { ok: false, message: validity.error.message };
  return {
    ok: true,
    pressed: (draft.type === "strum" && existing?.type === "strum" && existing.stroke === draft.stroke) ||
      (draft.type === "arpeggio" && existing?.type === "arpeggio" && existing.direction === draft.direction) ||
      (draft.type === "tie" && !!duplicate),
    command: existing
      ? { type: C.UpdateTechnique, trackId: track.id, techniqueId: existing.id, technique: draft }
      : { type: C.AddTechnique, trackId: track.id, technique: draft },
  };
};

/** Pressed state reflects the source technique even when the selected range cannot submit. */
export const currentStrumStroke = (document: ILXMDocument, selection: ILXMTabCellSelection | null): "down" | "up" | null => {
  return currentChordTechniqueDirection(document, selection, "strum");
};

/** Low-to-high gestures use an upward arrow for both strumming and arpeggiation. */
export const currentChordTechniqueDirection = (document: ILXMDocument, selection: ILXMTabCellSelection | null, type: "strum" | "arpeggio"): "down" | "up" | null => {
  if (!selection) return null;
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok || resolved.range.beats.length !== 1) return null;
  const technique = document.score.tracks.find((track) => track.id === resolved.range.trackId)?.techniques.find((item) =>
    item.type === type && "beatId" in item && item.beatId === resolved.range.beats[0]!.beatId);
  return technique?.type === "strum" ? technique.stroke
    : technique?.type === "arpeggio" ? technique.direction === "ascending" ? "down" : "up" : null;
};
