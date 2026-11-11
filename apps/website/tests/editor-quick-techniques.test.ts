import { describe, expect, it } from "vitest";
import { LXMScoreCommandEnum as C, type ILXMTabCellReference } from "@liuxianmao/lxm-editor";
import EXAMPLE from "../../../packages/lxm-editor/example/example-mvp2.json";
import { createEditorSession } from "../stores/editor-store";
import { currentChordTechniqueDirection, resolveQuickTechnique, resolveTechniqueDraft } from "../components/EditorShell/tools/editor-technique-target";
import { buildEditorToolCommand } from "../components/EditorShell/tools/editor-tool-actions";
import { deriveEditorToolState } from "../components/EditorShell/tools/editor-tool-state";

const setup = () => {
  const session = createEditorSession(EXAMPLE);
  const document = session.getState().document!;
  const track = document.score.tracks[0]!;
  const cell = (beat: string, string: number): ILXMTabCellReference => ({ trackId: track.id, measureId: track.measures[0]!.id,
    beatId: `mvp2-beat-1-${beat}`, string });
  return { session, document, track, cell };
};

describe("quick techniques share the domain target adapter", () => {
  it("延音线支持正反向同弦选择、单选下一音、重复 no-op 及撤销重做", () => {
    const { document: source, cell } = setup();
    const document = structuredClone(source);
    const notes = document.score.tracks[0]!.measures[0]!.beats.flatMap((beat) => beat.notes);
    notes.find((note) => note.id === "mvp2-note-1-6-6")!.fret = notes.find((note) => note.id === "mvp2-note-1-5-6")!.fret;
    const session = createEditorSession(document);
    const start = cell("5", 6), end = cell("6", 6);
    const selection = { anchor: start, focus: end };
    const target = resolveQuickTechnique(document, selection, "tie");
    expect(target).toMatchObject({ ok: true, pressed: false, command: {
      type: C.AddTechnique, technique: { type: "tie", fromNoteId: "mvp2-note-1-5-6", toNoteId: "mvp2-note-1-6-6" },
    } });
    expect(resolveQuickTechnique(document, { anchor: end, focus: start }, "tie")).toEqual(target);
    expect(resolveQuickTechnique(document, { anchor: start, focus: start }, "tie")).toEqual(target);
    const command = buildEditorToolCommand(document, selection, { type: "quickTechnique", technique: "tie" });
    expect(command).toEqual(target.ok ? target.command : null);
    if (!command) throw new Error("Missing tie command");
    expect(session.getState().execute(command)).toMatchObject({ ok: true, changed: true });
    const applied = session.getState().document;
    const depth = session.getState().historyDepth;
    const repeat = resolveQuickTechnique(applied!, selection, "tie");
    expect(repeat).toMatchObject({ ok: true, pressed: true });
    if (!repeat.ok) throw new Error(repeat.message);
    expect(session.getState().execute(repeat.command)).toMatchObject({ ok: true, changed: false });
    expect(session.getState().historyDepth).toEqual(depth);
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
    session.getState().redo();
    expect(session.getState().document).toEqual(applied);
  });

  it("延音线拒绝不同品位、多弦、缺失起音、无下一音和非相邻拍", () => {
    const { document, cell } = setup();
    expect(resolveQuickTechnique(document, { anchor: cell("5", 6), focus: cell("6", 6) }, "tie"))
      .toEqual({ ok: false, message: "延音线两端必须是同弦同品位" });
    expect(resolveQuickTechnique(document, { anchor: cell("5", 6), focus: cell("6", 5) }, "tie"))
      .toEqual({ ok: false, message: "请选择同一根弦上的音符。" });
    expect(resolveQuickTechnique(document, null, "tie").ok).toBe(false);
    expect(resolveQuickTechnique(document, { anchor: cell("5", 1), focus: cell("6", 1) }, "tie").ok).toBe(false);
    const last = document.score.tracks[0]!.measures.at(-1)!.beats.at(-1)!;
    const lastCell = { ...cell("5", 6), measureId: document.score.tracks[0]!.measures.at(-1)!.id, beatId: last.id };
    expect(resolveQuickTechnique(document, { anchor: lastCell, focus: lastCell }, "tie").ok).toBe(false);
    const sparse = structuredClone(document);
    const beats = sparse.score.tracks[0]!.measures[0]!.beats;
    beats.find((beat) => beat.id === cell("6", 6).beatId)!.notes = [];
    const later = beats.find((beat) => beat.id === cell("7", 6).beatId)!;
    later.notes = [{ id: "later-same-pitch", string: 6, fret: beats.find((beat) => beat.id === cell("5", 6).beatId)!.notes.find((note) => note.string === 6)!.fret }];
    expect(resolveQuickTechnique(sparse, { anchor: cell("5", 6), focus: cell("7", 6) }, "tie"))
      .toEqual({ ok: false, message: "延音线只能连接时间轴上相邻的两个 Beat" });
  });

  it.each([["x", 3], [3, "x"], ["x", "x"]] as const)("x endpoints %s/%s accept connection shortcuts without numeric pitch assumptions", (from, to) => {
    const { document: original, cell } = setup();
    const document = structuredClone(original);
    const notes = document.score.tracks[0]!.measures[0]!.beats.flatMap((beat) => beat.notes);
    notes.find((note) => note.id === "mvp2-note-1-5-6")!.fret = from;
    notes.find((note) => note.id === "mvp2-note-1-6-6")!.fret = to;
    const selection = { anchor: cell("5", 6), focus: cell("6", 6) };
    for (const quick of ["hammerOn", "pullOff", "slideUp", "slideDown", "slide", "tie"] as const)
      expect(resolveQuickTechnique(document, selection, quick)).toMatchObject({ ok: true });
    expect(resolveQuickTechnique(document, selection, "slide")).toMatchObject({
      command: { technique: { type: "slideUp" } },
    });
  });
  it("H accepts both selection directions, single-point uses next note, multi-string is disabled", () => {
    const { document, cell } = setup();
    const anchor = cell("5", 6), focus = cell("6", 6);
    for (const selection of [{ anchor, focus }, { anchor: focus, focus: anchor }, { anchor, focus: anchor }]) {
      expect(resolveQuickTechnique(document, selection, "hammerOn")).toMatchObject({ ok: true, command: {
        type: C.AddTechnique, technique: { type: "hammerOn", fromNoteId: "mvp2-note-1-5-6", toNoteId: "mvp2-note-1-6-6" },
      } });
    }
    expect(resolveQuickTechnique(document, { anchor, focus: { ...focus, string: 5 } }, "hammerOn"))
      .toEqual({ ok: false, message: "请选择同一根弦上的音符。" });
  });
  it("an invalid explicit target is rejected instead of silently selecting the next note", () => {
    const { document, cell } = setup();
    expect(resolveQuickTechnique(document, { anchor: cell("5", 6), focus: cell("7", 6) }, "hammerOn").ok).toBe(false);
    expect(resolveQuickTechnique(document, { anchor: cell("5", 6), focus: cell("6", 6) }, "pullOff").ok).toBe(false);
  });
  it("slide shortcuts submit their chosen direction with ordered same-string endpoints and no-op repeats", () => {
    const { session, cell, document } = setup();
    const start = cell("5", 6), end = cell("6", 6);
    const selection = { anchor: start, focus: end };
    const up = resolveQuickTechnique(document, selection, "slideUp");
    expect(up).toMatchObject({ ok: true, command: { type: C.AddTechnique, technique: {
      type: "slideUp", fromNoteId: "mvp2-note-1-5-6", toNoteId: "mvp2-note-1-6-6",
    } } });
    expect(resolveQuickTechnique(document, { anchor: end, focus: start }, "slideUp")).toEqual(up);
    expect(resolveQuickTechnique(document, { anchor: start, focus: start }, "slideUp")).toEqual(up);
    expect(resolveQuickTechnique(document, selection, "slideDown").ok).toBe(false);
    expect(resolveQuickTechnique(document, { anchor: start, focus: { ...end, string: 5 } }, "slideUp"))
      .toEqual({ ok: false, message: "请选择同一根弦上的音符。" });
    if (!up.ok) return;
    expect(session.getState().execute(up.command)).toMatchObject({ ok: true, changed: true });
    const depth = session.getState().historyDepth;
    const repeat = resolveQuickTechnique(session.getState().document!, selection, "slideUp");
    if (!repeat.ok) throw new Error(repeat.message);
    expect(session.getState().execute(repeat.command)).toMatchObject({ ok: true, changed: false });
    expect(session.getState().historyDepth).toEqual(depth);
    session.getState().undo();
    expect(session.getState().document).toBe(document);

    const lower = structuredClone(document);
    const notes = lower.score.tracks[0]!.measures[0]!.beats.flatMap((beat) => beat.notes);
    notes.find((note) => note.id === "mvp2-note-1-5-6")!.fret = 9;
    notes.find((note) => note.id === "mvp2-note-1-6-6")!.fret = 3;
    expect(resolveQuickTechnique(lower, selection, "slideDown")).toMatchObject({ ok: true, command: {
      technique: { type: "slideDown", fromNoteId: "mvp2-note-1-5-6", toNoteId: "mvp2-note-1-6-6" },
    } });
    expect(resolveQuickTechnique(lower, selection, "slideUp").ok).toBe(false);
  });
  it("shared connection resolver sorts complete endpoint cells, preserving other connection types", () => {
    const { document, cell } = setup();
    for (const type of ["slideUp", "slideDown", "tie"] as const) {
      const forward = resolveTechniqueDraft(document, { anchor: cell("5", 6), focus: cell("6", 5) }, type);
      const reverse = resolveTechniqueDraft(document, { anchor: cell("6", 5), focus: cell("5", 6) }, type);
      expect(reverse).toEqual(forward);
    }
  });
  it("S infers the slide direction from chronological frets and rejects equal frets", () => {
    const { session, document, cell } = setup();
    const start = cell("5", 6), end = cell("6", 6);
    const selection = { anchor: start, focus: end };
    const up = resolveQuickTechnique(document, selection, "slide");
    expect(up).toEqual(resolveQuickTechnique(document, selection, "slideUp"));
    expect(resolveQuickTechnique(document, { anchor: end, focus: start }, "slide")).toEqual(up);
    expect(resolveQuickTechnique(document, { anchor: start, focus: start }, "slide")).toEqual(up);
    if (!up.ok) throw new Error(up.message);
    expect(session.getState().execute(up.command)).toMatchObject({ ok: true, changed: true });
    const repeat = resolveQuickTechnique(session.getState().document!, selection, "slide");
    if (!repeat.ok) throw new Error(repeat.message);
    expect(session.getState().execute(repeat.command)).toMatchObject({ ok: true, changed: false });
    session.getState().undo();
    expect(session.getState().document).toBe(document);
    const lower = structuredClone(document);
    const notes = lower.score.tracks[0]!.measures[0]!.beats.flatMap((beat) => beat.notes);
    notes.find((note) => note.id === "mvp2-note-1-5-6")!.fret = 9;
    const last = notes.find((note) => note.id === "mvp2-note-1-6-6")!;
    last.fret = 3;
    expect(resolveQuickTechnique(lower, selection, "slide")).toMatchObject({ ok: true, command: {
      technique: { type: "slideDown" },
    } });
    expect(resolveQuickTechnique(lower, { anchor: end, focus: start }, "slide"))
      .toEqual(resolveQuickTechnique(lower, selection, "slide"));
    last.fret = 9;
    expect(resolveQuickTechnique(lower, selection, "slide")).toEqual({ ok: false, message: "滑音需要两个不同品位的同弦音符。" });
    expect(resolveQuickTechnique(document, { anchor: start, focus: { ...end, string: 5 } }, "slide").ok).toBe(false);
    expect(resolveQuickTechnique(document, null, "slide").ok).toBe(false);
  });
  it("up/down replaces the actual beat's arpeggio atomically, retains ID, replaces range and drops old direction", () => {
    const { session, cell } = setup();
    expect(session.getState().execute({ type: C.AddTechnique, trackId: cell("2", 2).trackId,
      technique: { type: "arpeggio", beatId: cell("2", 2).beatId, minString: 2, maxString: 3, direction: "ascending" } })?.ok).toBe(true);
    const before = session.getState().document!;
    const existing = before.score.tracks[0]!.techniques[0]!;
    const selection = { anchor: cell("2", 6), focus: cell("2", 1) };
    const target = resolveQuickTechnique(before, selection, "strumUp");
    expect(target).toMatchObject({ ok: true, pressed: false, command: { type: C.UpdateTechnique, techniqueId: existing.id,
      technique: { type: "strum", beatId: cell("2", 2).beatId, minString: 1, maxString: 6, stroke: "up" } } });
    if (!target.ok) return;
    expect(session.getState().execute(target.command)).toMatchObject({ ok: true, changed: true });
    const updated = session.getState().document!.score.tracks[0]!.techniques[0]!;
    expect(updated.id).toBe(existing.id);
    expect(updated).not.toHaveProperty("direction");
    expect(resolveQuickTechnique(session.getState().document!, selection, "strumUp")).toMatchObject({ pressed: true });
    expect(resolveQuickTechnique(session.getState().document!, selection, "strumDown")).toMatchObject({ pressed: false });
    session.getState().undo();
    expect(session.getState().document).toBe(before);
  });
  it("identical strum is a no-op preserving future; changed range updates rather than unions", () => {
    const { session, cell } = setup();
    const selection = { anchor: cell("2", 2), focus: cell("2", 3) };
    const add = buildEditorToolCommand(session.getState().document!, selection, { type: "quickTechnique", technique: "strumDown" })!;
    expect(session.getState().execute(add)).toMatchObject({ ok: true, changed: true });
    const first = session.getState().document!;
    const wider = buildEditorToolCommand(first, { anchor: cell("2", 1), focus: cell("2", 4) }, { type: "quickTechnique", technique: "strumDown" })!;
    expect(session.getState().execute(wider)).toMatchObject({ ok: true, changed: true });
    session.getState().undo();
    const depth = session.getState().historyDepth;
    const repeat = buildEditorToolCommand(session.getState().document!, selection, { type: "quickTechnique", technique: "strumDown" })!;
    expect(session.getState().execute(repeat)).toMatchObject({ ok: true, changed: false });
    expect(session.getState().document).toBe(first);
    expect(session.getState().historyDepth).toEqual(depth);
    const narrow = buildEditorToolCommand(first, { anchor: cell("2", 4), focus: cell("2", 2) }, { type: "quickTechnique", technique: "strumDown" })!;
    expect(narrow).toMatchObject({ technique: { minString: 2, maxString: 4 } });
  });
  it("both arpeggio shortcuts replace strumming, retain ID, undo once and repeat without adding history", () => {
    const { session, cell } = setup();
    const selection = { anchor: cell("2", 6), focus: cell("2", 1) };
    const strum = resolveQuickTechnique(session.getState().document!, selection, "strumDown");
    expect(strum.ok).toBe(true);
    if (!strum.ok) return;
    session.getState().execute(strum.command);
    const before = session.getState().document!;
    const id = before.score.tracks[0]!.techniques[0]!.id;
    for (const quick of ["arpeggioDown", "arpeggioUp"] as const) {
      const direction = quick === "arpeggioDown" ? "ascending" : "descending";
      const target = resolveQuickTechnique(session.getState().document!, selection, quick);
      expect(target).toMatchObject({ ok: true, command: { type: C.UpdateTechnique, techniqueId: id,
        technique: { type: "arpeggio", minString: 1, maxString: 6, direction } } });
      if (!target.ok) return;
      expect(session.getState().execute(target.command)).toMatchObject({ ok: true, changed: true });
      expect(session.getState().document!.score.tracks[0]!.techniques).toHaveLength(1);
      expect(session.getState().document!.score.tracks[0]!.techniques[0]).not.toHaveProperty("stroke");
      expect(currentChordTechniqueDirection(session.getState().document!, selection, "arpeggio")).toBe(quick === "arpeggioDown" ? "down" : "up");
      const repeat = resolveQuickTechnique(session.getState().document!, selection, quick);
      expect(repeat).toMatchObject({ ok: true, pressed: true });
      const depth = session.getState().historyDepth;
      if (repeat.ok) expect(session.getState().execute(repeat.command)).toMatchObject({ ok: true, changed: false });
      expect(session.getState().historyDepth).toEqual(depth);
    }
    session.getState().undo();
    session.getState().undo();
    expect(session.getState().document).toBe(before);
  });
  it("rest toggle normalizes mixed multi-beat state once, and restore never restores notes", () => {
    const { session, cell } = setup();
    const selection = { anchor: cell("1", 2), focus: cell("2", 2) };
    const first = buildEditorToolCommand(session.getState().document!, { anchor: cell("1", 2), focus: cell("1", 2) }, { type: "rest" })!;
    expect(session.getState().execute(first)?.ok).toBe(true);
    expect(deriveEditorToolState(session.getState().document!, selection).restState).toBe("mixed");
    const command = buildEditorToolCommand(session.getState().document!, selection, { type: "restToggle" })!;
    expect(command).toMatchObject({ type: C.SetBeatKindRange, kind: "rest" });
    expect(session.getState().execute(command)?.ok).toBe(true);
    expect(deriveEditorToolState(session.getState().document!, selection).restState).toBe("all");
    const restore = buildEditorToolCommand(session.getState().document!, selection, { type: "restToggle" })!;
    expect(restore).toMatchObject({ kind: "notes" });
    expect(session.getState().execute(restore)?.ok).toBe(true);
    for (const beat of session.getState().document!.score.tracks[0]!.measures[0]!.beats.slice(0, 2)) expect(beat.notes).toEqual([]);
  });
});
