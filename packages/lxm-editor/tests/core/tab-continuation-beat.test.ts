import { describe, expect, it } from "vitest";
import DEFAULT_DOCUMENT from "../../example/default-score";
import { applyScoreCommand, LXMScoreCommandEnum as C, type ILXMScoreCommand } from "../../src/core/commands/commands";
import type { ILXMDocument } from "../../src/core/types";
import { buildLayout, hitTestLayout } from "../../src/layout";
import { loadDocument } from "../../src/core/document/loader";
import { buildScoreScene } from "../../src/presentation/score-scene";
import { layoutTabCellCaret } from "../../src/layout/selection-layout";

const fixture = (): ILXMDocument => {
  const document = structuredClone(DEFAULT_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = [track.measures[0]!];
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.tuplets = [];
  measure.numberedVoice = { events: [], tuplets: [] };
  measure.beats = [0, 960, 1920, 2880].map((tick, i) => ({
    id: `tab-${i}`, tick, rhythm: { base: "quarter", dots: 0 }, kind: "notes", notes: [],
  }));
  return document;
};
const target = (document: ILXMDocument, beatId = "tab-0") => ({
  trackId: document.score.tracks[0]!.id,
  measureId: document.score.tracks[0]!.measures[0]!.id,
  beatId,
});
const set = (document: ILXMDocument, beatId = "tab-0", endBeatId = beatId) => {
  const cell = target(document, beatId);
  return applyScoreCommand(document, { type: C.SetTabContinuation, range: {
    trackId: cell.trackId, anchor: cell, focus: { ...cell, beatId: endBeatId },
  } });
};

describe("BUG018 TAB beat continuation", () => {
  it("legacy multi-string dash renders once at staff center without duration marks", () => {
    const document = fixture();
    document.score.tracks[0]!.measures[0]!.beats[0]!.notes = [1, 6].map((string) => ({ id: `dash-${string}`, string, fret: "-" }));
    const before = structuredClone(document);
    const measure = buildLayout(document).systems[0]!.measures[0]!;
    expect(measure.notes).toHaveLength(1);
    expect(measure.notes[0]!.y).toBeCloseTo((measure.strings[0]!.y1 + measure.strings[5]!.y1) / 2);
    expect(measure.durationMarks).toHaveLength(0);
    expect(measure.beamSegments).toHaveLength(0);
    expect(document).toEqual(before);
  });

  it.each([[2, 4, "quarter"], [3, 4, "quarter"], [4, 4, "quarter"], [6, 8, "eighth"]] as const)("%s/%s writes one unit beat, ignores numbered rhythm, repeats no-op", (numerator, denominator, base) => {
    const document = fixture();
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.timeSignature = { numerator, denominator };
    const ticks = 3840 / denominator;
    measure.beats = Array.from({ length: numerator }, (_, i) => ({ id: `tab-${i}`, tick: i * ticks, rhythm: { base, dots: 0 }, kind: "rest", notes: [] }));
    // 简谱节奏独立，不能让延音继承简谱附点。
    measure.numberedVoice = { tuplets: [], events: [{ id: "n", tick: 0, kind: "notes", rhythm: { base: "eighth", dots: 1 }, items: [{ id: "ni", token: "1" }] }] };
    const result = set(document, "tab-0", "tab-1");
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    const next = result.document.score.tracks[0]!.measures[0]!;
    expect(next.numberedVoice).toBe(measure.numberedVoice);
    expect(next.beats.slice(0, 2).map((beat) => [beat.tick, beat.rhythm, beat.notes.length])).toEqual([
      [0, { base, dots: 0 }, 1], [ticks, { base, dots: 0 }, 1],
    ]);
    const repeat = set(result.document, "tab-0", "tab-1");
    expect(repeat).toMatchObject({ ok: true, changed: false });
    if (repeat.ok) expect(repeat.document).toBe(result.document);
    expect(loadDocument(JSON.stringify(result.document))).toEqual({ ok: true, document: result.document });
  });

  it("fixed window merges empty rests and splits remainder without moving later notes", () => {
    const document = fixture();
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.beats = [
      { id: "tab-0", tick: 0, kind: "notes", notes: [{ id: "old", string: 6, fret: 5 }], rhythm: { base: "eighth", dots: 0 } },
      { id: "blank", tick: 480, kind: "rest", notes: [], rhythm: { base: "quarter", dots: 1 } },
      { id: "tab-2", tick: 1920, kind: "notes", notes: [{ id: "later", string: 1, fret: 7 }], rhythm: { base: "half", dots: 0 } },
    ];
    const later = measure.beats[2]!;
    const result = set(document);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const beats = result.document.score.tracks[0]!.measures[0]!.beats;
    expect(beats.map((beat) => [beat.tick, beat.rhythm])).toEqual([[0, { base: "quarter", dots: 0 }], [960, { base: "quarter", dots: 0 }], [1920, { base: "half", dots: 0 }]]);
    expect(beats[2]).toBe(later);
    expect(beats[0]!.notes).toEqual([{ id: expect.any(String), string: 3, fret: "-" }]);
  });

  it.each(["note", "chord", "pickStroke", "letRing", "palmMute", "tuplet"])("rejects following %s atomically instead of compressing/moving it", (kind) => {
    const document = fixture();
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    measure.beats = Array.from({ length: 8 }, (_, i) => ({ id: `tab-${i}`, tick: i * 480, kind: "notes", notes: [], rhythm: { base: "eighth", dots: 0 } }));
    const following = measure.beats[3]!;
    if (kind === "note" || kind === "pickStroke") following.notes = [{ id: "real", string: 2, fret: 3 }];
    if (kind === "chord") measure.chordSymbols = [{ id: "ch", beatId: following.id, display: "name", chord: { name: "C", diagram: null } }];
    if (kind === "pickStroke") track.techniques = [{ id: "pick", type: "pickStroke", beatId: following.id, stroke: "down" }];
    if (kind === "letRing" || kind === "palmMute") track.techniques = [{ id: "range", type: kind, fromBeatId: "tab-0", toBeatId: "tab-7" }];
    if (kind === "tuplet") measure.tuplets = [{ id: "tuple", beatIds: [following.id], ratio: { actual: 3, normal: 2 } }];
    const before = structuredClone(document);
    expect(set(document, "tab-2")).toMatchObject({ ok: false, code: "INVALID_BEAT_OPERATION" });
    expect(document).toEqual(before);
  });

  it("conversion replaces all current strings and removes their techniques atomically", () => {
    const document = fixture();
    const track = document.score.tracks[0]!;
    const beat = track.measures[0]!.beats[0]!;
    beat.notes = [{ id: "old", string: 6, fret: 5 }];
    track.techniques = [{ id: "pick", type: "pickStroke", beatId: beat.id, stroke: "down" }, { id: "vib", type: "vibrato", fromNoteId: "old" }];
    const result = set(document);
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.techniques).toEqual([]);
    expect(result.document.score.tracks[0]!.measures[0]!.beats[0]!.notes).toEqual([{ id: expect.any(String), string: 3, fret: "-" }]);
  });

  it.each([false, true])("number/x entry on a pure legacy beat clears every old dash (rect=%s)", (rect) => {
    for (const fret of [7, "x"] as const) {
      const document = fixture();
      document.score.tracks[0]!.measures[0]!.beats[0]!.notes = [1, 6].map((string) => ({ id: `dash-${string}`, string, fret: "-" }));
      const cell = { ...target(document), string: 4 };
      const result = applyScoreCommand(document, rect ? { type: C.SetNotesInRect, range: { trackId: cell.trackId, anchor: cell, focus: cell }, fret } : { type: C.SetNote, ...cell, fret });
      expect(result).toMatchObject({ ok: true });
      if (result.ok) expect(result.document.score.tracks[0]!.measures[0]!.beats[0]!.notes).toEqual([{ id: expect.any(String), string: 4, fret }]);
    }
  });

  it("legacy pure/mixed data round trips unchanged; mixed beats keep their stem and per-string editing", () => {
    const document = fixture();
    const beats = document.score.tracks[0]!.measures[0]!.beats;
    beats[0]!.notes = [{ id: "dash-1", string: 1, fret: "-" }, { id: "dash-6", string: 6, fret: "-" }];
    beats[1]!.notes = [{ id: "mix-dash", string: 1, fret: "-" }, { id: "mix-attack", string: 6, fret: "x" }];
    expect(loadDocument(JSON.stringify(document))).toEqual({ ok: true, document });
    const measure = buildLayout(document).systems[0]!.measures[0]!;
    expect(measure.notes.filter((note) => note.beatId === "tab-1")).toHaveLength(2);
    expect(measure.durationMarks.some((mark) => mark.beatId === "tab-1")).toBe(true);
    const result = applyScoreCommand(document, { type: C.RemoveNote, ...target(document, "tab-1"), string: 6 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.document.score.tracks[0]!.measures[0]!.beats[1]!.notes).toEqual([beats[1]!.notes[0]]);
  });

  it("rhythm, dots, split, merge, tuplet and pick stroke cannot recreate an irregular continuation", () => {
    const result = set(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = result.document;
    const cell = target(document);
    for (const command of [
      { type: C.SetBeatRhythm, ...cell, rhythm: { base: "half" as const, dots: 0 } },
      { type: C.SetBeatRhythm, ...cell, rhythm: { base: "quarter" as const, dots: 1 } },
      { type: C.SplitBeat, ...cell },
      { type: C.MergeBeats, ...cell, startBeatId: "tab-0", endBeatId: "tab-1" },
      { type: C.SetTuplet, ...cell, startBeatId: "tab-0", endBeatId: "tab-2", ratio: { actual: 3, normal: 2 } },
      { type: C.AddTechnique, trackId: cell.trackId, technique: { type: "pickStroke" as const, beatId: cell.beatId, stroke: "down" as const } },
    ] satisfies ILXMScoreCommand[]) expect(applyScoreCommand(document, command)).toMatchObject({ ok: false });
  });

  it("editor/export share one centered line, any string hits the beat and caret covers it", () => {
    const result = set(fixture());
    if (!result.ok) throw new Error(result.message);
    const layout = buildLayout(result.document);
    const measure = layout.systems[0]!.measures[0]!;
    const note = measure.notes[0]!;
    expect(note.tabContinuation).toBe(true);
    expect(buildScoreScene(layout).systems[0]!.items).toContainEqual(expect.objectContaining({ kind: "line", x1: note.x - 6, x2: note.x + 6, y1: note.y, y2: note.y }));
    for (const string of measure.strings) expect(hitTestLayout(layout, { x: note.x, y: string.y1 })).toMatchObject({ beatId: "tab-0" });
    const caret = layoutTabCellCaret(layout, { ...target(result.document), string: 6 })!;
    expect(caret.y).toBeLessThan(measure.strings[0]!.y1);
    expect(caret.y + caret.height).toBeGreaterThan(measure.strings[5]!.y1);
  });

  it.each([false, true])("delete on any string clears the whole pure continuation (rect=%s)", (rect) => {
    const document = fixture();
    document.score.tracks[0]!.measures[0]!.beats[0]!.notes = [{ id: "dash", string: 1, fret: "-" }];
    const cell = { ...target(document), string: 6 };
    const result = applyScoreCommand(document, rect
      ? { type: C.RemoveNotesInRect, range: { trackId: cell.trackId, anchor: cell, focus: cell } }
      : { type: C.RemoveNote, ...cell });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok) expect(result.document.score.tracks[0]!.measures[0]!.beats[0]!.notes).toEqual([]);
  });
});
