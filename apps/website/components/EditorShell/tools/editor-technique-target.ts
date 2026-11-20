import {
  findNextNoteOnSameStringInTrack,
  resolveTabCellSelection,
  sameTechniqueDraft,
  validateTechnique,
  isPureTabContinuationBeat,
  LXMScoreCommandEnum as C,
  type ILXMDocument,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type ILXMTechniqueDraft,
  type ILXMTechniqueType,
  type ILXMTrack,
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
const fail = (message: string) => ({ ok: false as const, message });

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
  const focusBeat = track.measures.find((measure) => measure.id === selection.focus.measureId)
    ?.beats.find((beat) => beat.id === selection.focus.beatId);
  if (focusBeat && isPureTabContinuationBeat(focusBeat) && type !== "palmMute" && type !== "letRing")
    return fail("横线延音标记没有实际起音，不能作为弹奏技巧的目标。");
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

const findChordTraversal = (track: ILXMTrack, beatId: string) =>
  track.techniques.find((item) =>
    (item.type === "strum" || item.type === "arpeggio") && item.beatId === beatId);

const removeQuickTechnique = (trackId: string, techniqueId: string) => ({
  ok: true as const,
  pressed: true,
  command: { type: C.RemoveTechnique as const, trackId, techniqueId },
});

export const resolveQuickTechnique = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  quick: QuickTechnique,
): { ok: true; command: ILXMScoreCommand; pressed: boolean } | { ok: false; message: string } => {
  const strum = quick === "strumDown" || quick === "strumUp";
  const arpeggio = quick === "arpeggioDown" || quick === "arpeggioUp";
  const direction = quick === "strumUp" || quick === "arpeggioUp" ? "up" : "down";
  if (
    (strum || arpeggio) && selection &&
    selection.anchor.beatId === selection.focus.beatId &&
    selection.anchor.string === selection.focus.string
  ) {
    const selected = resolveTabCellSelection(document, selection);
    if (!selected.ok) return fail(selected.message);
    const track = document.score.tracks.find((item) => item.id === selected.range.trackId)!;
    // 单格可以取消该拍现有技巧，新增或更改弦范围仍需显式多弦选择。
    const existing = findChordTraversal(track, selected.range.beats[0]!.beatId);
    if (
      (strum && existing?.type === "strum" && existing.stroke === direction) ||
      (arpeggio && existing?.type === "arpeggio" &&
        existing.direction === (direction === "down" ? "ascending" : "descending"))
    ) {
      return removeQuickTechnique(track.id, existing.id);
    }
    return fail("扫弦和琶音需要在同一 Beat 内选择至少两根弦线。");
  }
  const type = strum ? "strum" : arpeggio ? "arpeggio" : quick === "slide" ? "slideUp" : quick;
  const target = resolveTechniqueDraft(document, selection, type, {
    direction, semitones: 2, trillFret: 7,
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
  const duplicate = track.techniques.find((item) => sameTechniqueDraft(item, draft));
  if (duplicate) return removeQuickTechnique(track.id, duplicate.id);

  const existing = draft.type === "strum" || draft.type === "arpeggio"
    ? findChordTraversal(track, draft.beatId)
    : undefined;
  const validity = validateTechnique(track, draft, existing?.id);
  if (!validity.ok) return { ok: false, message: validity.error.message };
  return {
    ok: true,
    pressed: false,
    command: existing
      ? { type: C.UpdateTechnique, trackId: track.id, techniqueId: existing.id, technique: draft }
      : { type: C.AddTechnique, trackId: track.id, technique: draft },
  };
};
