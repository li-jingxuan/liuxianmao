import { resolveTabCellSelection, resolveTechniqueSelection, validateTechnique,
  type ILXMDocument, type ILXMTabCellSelection, type ILXMTechniqueType } from "@liuxianmao/lxm-editor";
import { resolveTechniqueDraft, type TechniqueParameters } from "./editor-technique-target";

export const parseTechniqueTrillFret = (text: string) => /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;

export const techniqueNeedsParameters = (type: ILXMTechniqueType) =>
  ["bend", "trill", "strum", "arpeggio", "pickStroke"].includes(type);
export const techniqueNeedsConnection = (type: ILXMTechniqueType) =>
  ["hammerOn", "pullOff", "slideUp", "slideDown", "tie", "traversalTie"].includes(type);

/** 两种谱面延音线共用一个入口，适用的端点由当前选区决定。 */
export const toolbarTechniqueType = (type: ILXMTechniqueType): ILXMTechniqueType =>
  type === "traversalTie" ? "tie" : type;

/** Parameter edits retain every reference of the identified object, regardless of selection focus. */
export const resolveToolbarTechnique = (document: ILXMDocument, selection: ILXMTabCellSelection | null,
  type: ILXMTechniqueType, parameters: TechniqueParameters, techniqueId: string | null = null) => {
  const track = techniqueId ? document.score.tracks.find(item => item.techniques.some(value => value.id === techniqueId)) : null;
  const existing = track?.techniques.find(item => item.id === techniqueId);
  if (techniqueId && !existing) return { ok: false as const, message: "技巧对象已失效，请重新选择。" };
  let target = resolveTechniqueDraft(document,
    techniqueId ? resolveTechniqueSelection(document, techniqueId, "end") : selection, type, parameters, true);
  if (existing && track && toolbarTechniqueType(existing.type) === toolbarTechniqueType(type)) {
    const { id: _id, ...draft } = existing;
    if (draft.type === "bend") draft.semitones = parameters.semitones;
    if (draft.type === "trill") draft.auxiliaryFret = parameters.trillFret;
    if (draft.type === "arpeggio") draft.direction = parameters.direction === "down" ? "ascending" : "descending";
    if (draft.type === "strum" || draft.type === "pickStroke") draft.stroke = parameters.direction;
    target = { ok: true, trackId: track.id, draft };
  }
  if (!target.ok) return target;
  if (target.draft.type === "trill" && (!Number.isInteger(target.draft.auxiliaryFret) || target.draft.auxiliaryFret < 0 || target.draft.auxiliaryFret > 24))
    return { ok: false as const, message: "辅助品位须为 0–24 的整数。" };
  const validity = validateTechnique(document.score.tracks.find(item => item.id === target.trackId)!, target.draft, techniqueId ?? undefined);
  return validity.ok ? target : { ok: false as const, message: validity.error.message };
};

/** Parameter tiles remain available when at least one explicit value is valid. */
export const toolbarTechniqueAvailability = (document: ILXMDocument, selection: ILXMTabCellSelection | null,
  type: ILXMTechniqueType, techniqueId: string | null) => {
  const base: TechniqueParameters = { direction: "down", semitones: 2, trillFret: 7 };
  const variants: TechniqueParameters[] = type === "trill"
    ? Array.from({ length: 25 }, (_, trillFret) => ({ ...base, trillFret }))
    : type === "bend" ? [{ ...base, semitones: 1 }, base]
      : [base, { ...base, direction: "up" }];
  let message = "该技巧不可用于当前目标。";
  for (const parameters of variants) {
    const target = resolveToolbarTechnique(document, selection, type, parameters, techniqueId);
    if (target.ok) return null;
    message = target.message;
  }
  return message;
};

export const techniquesInToolbarSelection = (document: ILXMDocument, selection: ILXMTabCellSelection | null) => {
  if (!selection) return [];
  const resolved = resolveTabCellSelection(document, selection);
  if (!resolved.ok) return [];
  const track = document.score.tracks.find(item => item.id === resolved.range.trackId);
  if (!track) return [];
  const beats = track.measures.flatMap(measure => measure.beats);
  const selectedBeats = new Set(resolved.range.beats.map(beat => beat.beatId));
  const notes = new Set(beats.filter(beat => selectedBeats.has(beat.id)).flatMap(beat => beat.notes
    .filter(note => note.string >= resolved.range.startString && note.string <= resolved.range.endString).map(note => note.id)));
  return track.techniques.filter(item => {
    if ("fromNoteId" in item) return notes.has(item.fromNoteId) || ("toNoteId" in item && notes.has(item.toNoteId));
    if ("beatId" in item) return selectedBeats.has(item.beatId);
    const start = beats.findIndex(beat => beat.id === item.fromBeatId), end = beats.findIndex(beat => beat.id === item.toBeatId);
    return beats.slice(start, end + 1).some(beat => selectedBeats.has(beat.id));
  });
};
