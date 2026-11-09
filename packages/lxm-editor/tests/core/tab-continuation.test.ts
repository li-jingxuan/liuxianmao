import { describe, expect, it } from "vitest";
import DEFAULT_MOCK_DOCUMENT from "../../example/default-score";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as C,
  type ILXMScoreCommand,
} from "../../src/core/commands";
import { loadDocument } from "../../src/core/loader";
import { LXMDocumentSchema } from "../../src/core/schema";
import { validateTechnique } from "../../src/core/technique-rules";
import type {
  ILXMDocument,
  ILXMTechniqueDraft,
} from "../../src/core/types";
import { buildLayout, hitTestLayout } from "../../src/layout";

const apply = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(result.message);
  return result;
};

const lastCell = (document: ILXMDocument) => {
  const track = document.score.tracks[0]!;
  const measure = track.measures.at(-1)!;
  return {
    type: C.SetNote as const,
    trackId: track.id,
    measureId: measure.id,
    beatId: measure.beats.at(-1)!.id,
    string: 3,
    fret: "-" as const,
  };
};

const techniqueFixture = () => {
  const document = structuredClone(DEFAULT_MOCK_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.techniques = [];
  measure.chordSymbols = [];
  measure.tuplets = [];
  measure.beats = Array.from({ length: 4 }, (_, i) => ({
    id: `continuation-beat-${i}`,
    tick: i * 960,
    rhythm: { base: "quarter" as const, dots: 0 },
    kind: i < 2 ? "notes" as const : "rest" as const,
    notes: i < 2 ? [{ id: `continuation-note-${i}`, string: 3, fret: 5 }] : [],
  }));
  return { document, track, measure };
};

const connections = ["hammerOn", "pullOff", "slideUp", "slideDown", "tie"] as const;
const singles = ["bend", "vibrato", "naturalHarmonic", "artificialHarmonic", "tapping", "trill"] as const;
const draftFor = (type: typeof connections[number] | typeof singles[number]): ILXMTechniqueDraft => ({
  type,
  fromNoteId: "continuation-note-0",
  ...(connections.some((connection) => connection === type)
    ? { toNoteId: "continuation-note-1" } : {}),
  ...(type === "bend" ? { semitones: 2 } : {}),
  ...(type === "trill" ? { auxiliaryFret: 9 } : {}),
} as ILXMTechniqueDraft);

describe("TAB 横线延音标记 -", () => {
  it("真实默认谱末拍 tick2880 空 quarter 可输入横线，保持时值、简谱、歌词并保存加载往返", () => {
    const document = DEFAULT_MOCK_DOCUMENT;
    const before = structuredClone(document);
    const command = lastCell(document);
    const previous = document.score.tracks[0]!.measures.at(-1)!.beats.at(-1)!;
    expect(previous).toMatchObject({
      tick: 2880, kind: "notes", notes: [], rhythm: { base: "quarter", dots: 0 },
    });
    const result = apply(document, command);
    expect(result.changed).toBe(true);
    expect(result.document.schemaVersion).toBe(8);
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    const next = result.document.score.tracks[0]!.measures.at(-1)!.beats.at(-1)!;
    expect(next).toMatchObject({ ...previous, notes: [{ id: expect.any(String), string: 3, fret: "-" }] });
    expect(result.document.score.tracks[0]!.techniques).toEqual(document.score.tracks[0]!.techniques);
    for (const [i, measure] of document.score.tracks[0]!.measures.entries()) {
      const updated = result.document.score.tracks[0]!.measures[i]!;
      expect(updated.beats.map(({ id, tick, rhythm, kind }) => ({ id, tick, rhythm, kind })))
        .toEqual(measure.beats.map(({ id, tick, rhythm, kind }) => ({ id, tick, rhythm, kind })));
      expect(updated.numberedVoice).toBe(measure.numberedVoice);
      expect(updated.lyrics).toBe(measure.lyrics);
      expect(updated.chordSymbols).toBe(measure.chordSymbols);
    }
    expect(LXMDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(loadDocument(JSON.stringify(result.document))).toEqual({ ok: true, document: result.document });
    const noop = apply(result.document, command);
    expect(noop.changed).toBe(false);
    expect(noop.document).toBe(result.document);
    expect(document).toEqual(before);

    for (const systemWidth of [300, 733]) {
      const layout = buildLayout(result.document, { systemWidth });
      const note = layout.systems.flatMap((s) => s.measures.flatMap((m) => m.notes))
        .find((note) => note.id === next.notes[0]!.id)!;
      expect(note).toMatchObject({ fret: "-", fretText: "-" });
      expect([note.x, note.y].every(Number.isFinite)).toBe(true);
      expect(hitTestLayout(layout, { x: note.x, y: note.y }))
        .toMatchObject({ beatId: next.id, string: 3 });
    }
  });

  it("跨小节矩形逐弦输入横线，保留已有音符 ID 且重复输入 no-op", () => {
    const document = DEFAULT_MOCK_DOCUMENT;
    const track = document.score.tracks[0]!;
    const left = track.measures.at(-2)!;
    const right = track.measures.at(-1)!;
    const command = {
      type: C.SetNotesInRect as const,
      range: {
        trackId: track.id,
        anchor: { measureId: left.id, beatId: left.beats.at(-1)!.id, string: 2 },
        focus: { measureId: right.id, beatId: right.beats.at(-1)!.id, string: 6 },
      },
      fret: "-" as const,
    };
    const result = apply(document, command);
    const updatedTrack = result.document.score.tracks[0]!;
    for (const measure of [left, right]) {
      const selected = measure === left ? measure.beats.slice(-1) : measure.beats;
      const updated = updatedTrack.measures.find((m) => m.id === measure.id)!;
      expect(updated.numberedVoice).toBe(measure.numberedVoice);
      expect(updated.lyrics).toBe(measure.lyrics);
      for (const beat of selected) {
        const next = updated.beats.find((b) => b.id === beat.id)!;
        expect(next.tick).toBe(beat.tick);
        expect(next.rhythm).toEqual(beat.rhythm);
        for (const string of [2, 3, 4, 5, 6]) {
          const note = next.notes.find((n) => n.string === string)!;
          expect(note.fret).toBe("-");
          const previous = beat.notes.find((n) => n.string === string);
          if (previous) expect(note.id).toBe(previous.id);
        }
      }
    }
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    expect(apply(result.document, command)).toMatchObject({ changed: false, document: result.document });
  });

  it.each([0, 24, "x"] as const)("横线可改回 %s，保留 ID 并往返", (fret) => {
    const command = lastCell(DEFAULT_MOCK_DOCUMENT);
    const inserted = apply(DEFAULT_MOCK_DOCUMENT, command).document;
    const previous = inserted.score.tracks[0]!.measures.at(-1)!.beats.at(-1)!.notes[0]!;
    const result = apply(inserted, { ...command, fret });
    expect(result.document.score.tracks[0]!.measures.at(-1)!.beats.at(-1)!.notes[0])
      .toEqual({ ...previous, fret });
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });

  it.each(connections)("%s 拒绝横线起点及终点，命令和加载语义校验一致", (type) => {
    for (const endpoint of [0, 1]) {
      const { document, track, measure } = techniqueFixture();
      measure.beats[endpoint]!.notes[0]!.fret = "-";
      const technique = draftFor(type);
      expect(validateTechnique(track, technique)).toMatchObject({
        ok: false, error: { code: "TECHNIQUE_TARGET_INVALID", field: endpoint === 0 ? "fromNoteId" : "toNoteId" },
      });
      expect(applyScoreCommand(document, { type: C.AddTechnique, trackId: track.id, technique }))
        .toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });
      track.techniques = [{ id: "invalid-continuation-technique", ...technique }];
      expect(loadDocument(JSON.stringify(document)).ok).toBe(false);
    }
  });

  it.each(singles)("%s 拒绝横线目标", (type) => {
    const { document, track, measure } = techniqueFixture();
    measure.beats[0]!.notes[0]!.fret = "-";
    const technique = draftFor(type);
    expect(validateTechnique(track, technique)).toMatchObject({
      ok: false, error: { code: "TECHNIQUE_TARGET_INVALID", field: "fromNoteId" },
    });
    expect(applyScoreCommand(document, { type: C.AddTechnique, trackId: track.id, technique }))
      .toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });
    track.techniques = [{ id: "invalid-continuation-technique", ...technique }];
    expect(loadDocument(JSON.stringify(document)).ok).toBe(false);
  });

  it.each([C.SetNote, C.SetNotesInRect] as const)("%s 替换技巧任一端点时原子清理，保留其他技巧", (type) => {
    for (const endpoint of [0, 1]) {
      const { document, track, measure } = techniqueFixture();
      track.techniques = [
        { id: "remove-tie", type: "tie", fromNoteId: "continuation-note-0", toNoteId: "continuation-note-1" },
        { id: "remove-vibrato", type: "vibrato", fromNoteId: `continuation-note-${endpoint}` },
        { id: "keep-bend", type: "bend", fromNoteId: `continuation-note-${1 - endpoint}`, semitones: 2 },
      ];
      const before = structuredClone(document);
      const beat = measure.beats[endpoint]!;
      const cell = { measureId: measure.id, beatId: beat.id, string: 3 };
      const command = type === C.SetNote
        ? { type, trackId: track.id, ...cell, fret: "-" as const }
        : { type, range: { trackId: track.id, anchor: cell, focus: cell }, fret: "-" as const };
      const result = apply(document, command);
      expect(result.document.score.tracks[0]!.techniques).toEqual([track.techniques[2]]);
      expect(result.document.score.tracks[0]!.measures[0]!.beats[endpoint]!.notes[0])
        .toEqual({ ...beat.notes[0]!, fret: "-" });
      expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
      expect(document).toEqual(before);
    }
  });

  it.each([false, true])("拒绝从横线源拍延续一拍（混合起音 %s），原文档不变", (mixed) => {
    const { document, track, measure } = techniqueFixture();
    const source = measure.beats[1]!;
    source.notes[0]!.fret = "-";
    if (mixed) source.notes.push({ id: "actual-attack", string: 1, fret: 7 });
    const before = structuredClone(document);
    expect(applyScoreCommand(document, {
      type: C.ExtendBeat, trackId: track.id, measureId: measure.id, beatId: source.id,
    })).toMatchObject({ ok: false, code: "INVALID_BEAT_OPERATION", message: expect.stringContaining("延音标记 -") });
    expect(document).toEqual(before);
  });
});
