import { describe, expect, it } from "vitest";
import { applyScoreCommand, LXMScoreCommandEnum as C } from "../../src/core/commands";
import DEFAULT_MOCK_DOCUMENT from "../../example/default-score";
import type { ILXMDocument, ILXMRhythm, ILXMScoreCommand } from "../../src/index";
import { tabInputRhythmFromNumbered } from "../../src/core/tab-input-rhythm";
import { buildLayout, hitTestLayout } from "../../src/layout";

export const numberedFirstDocument = (): ILXMDocument => {
  const document = structuredClone(DEFAULT_MOCK_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = [track.measures[0]!];
  const measure = track.measures[0]!;
  measure.chordSymbols = [];
  measure.lyrics = [];
  measure.tuplets = [];
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.beats = [0, 960, 1920, 2880].map((tick, i) => ({
    id: `tab-${i}`, tick, rhythm: { base: "quarter", dots: 0 }, kind: "notes", notes: [],
  }));
  measure.numberedVoice = {
    tuplets: [],
    events: ([
      { tick: 0, rhythm: { base: "eighth", dots: 1 } },
      { tick: 720, rhythm: { base: "sixteenth", dots: 0 } },
      { tick: 960, rhythm: { base: "half", dots: 0 } },
      { tick: 2880, rhythm: { base: "quarter", dots: 0 } },
    ] satisfies { tick: number; rhythm: ILXMRhythm }[]).map((event, i) => ({ ...event, id: `numbered-${i}`, kind: "notes", items: [{ id: `item-${i}`, token: "1" }] })),
  };
  return document;
};

const setNote = (document: ILXMDocument, beatId: string, rect: boolean): ILXMScoreCommand => {
  const track = document.score.tracks[0]!;
  const target = { trackId: track.id, measureId: track.measures[0]!.id, beatId, string: 1 };
  return rect
    ? { type: C.SetNotesInRect, range: { trackId: track.id, anchor: target, focus: target }, fret: 3 }
    : { type: C.SetNote, ...target, fret: 3 };
};

describe("BUG016 简谱先录入后的空 TAB 节奏", () => {
  it.each(["notes", "rest", "chord", "technique", "range", "tabTuplet", "numberedTuplet"])("较长简谱不能吞掉后续 %s", (content) => {
    const document = numberedFirstDocument();
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const protectedBeat = measure.beats[2]!;
    if (content === "notes") protectedBeat.notes = [{ id: "real-note", string: 2, fret: 5 }];
    if (content === "rest") protectedBeat.kind = "rest";
    if (content === "chord") measure.chordSymbols = [{ id: "chord", beatId: protectedBeat.id, display: "name", chord: { name: "C", diagram: null } }];
    if (content === "technique") track.techniques = [{ id: "ring", type: "letRing", fromBeatId: protectedBeat.id, toBeatId: measure.beats[3]!.id }];
    if (content === "range") track.techniques = [{ id: "ring", type: "letRing", fromBeatId: measure.beats[0]!.id, toBeatId: measure.beats[3]!.id }];
    // 查询在规划阶段即保守跳过连音；此处不向命令提交不完整组。
    if (content === "tabTuplet") measure.tuplets = [{ id: "tuple", beatIds: [protectedBeat.id], ratio: { actual: 3, normal: 2 } }];
    if (content === "numberedTuplet") measure.numberedVoice.tuplets = [{ id: "n-tuple", eventIds: ["numbered-2"], ratio: { actual: 3, normal: 2 } }];
    const before = structuredClone(document);
    expect(tabInputRhythmFromNumbered(track, measure, "tab-1")).toBeUndefined();
    if (content.endsWith("Tuplet")) return;
    const result = applyScoreCommand(document, setNote(document, "tab-1", false));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.measures[0]!.beats[1]!.rhythm).toEqual({ base: "quarter", dots: 0 });
    expect(result.document.score.tracks[0]!.measures[0]!.beats[2]).toEqual(before.score.tracks[0]!.measures[0]!.beats[2]);
    expect(result.document.score.tracks[0]!.techniques).toEqual(before.score.tracks[0]!.techniques);
  });

  it.each([false, true])("已有TAB内容与显式时值保持独立（rect=%s）", (rect) => {
    for (const explicit of [false, true]) {
      const document = numberedFirstDocument();
      if (!explicit) document.score.tracks[0]!.measures[0]!.beats[0]!.notes = [{ id: "own-note", string: 2, fret: 7 }];
      const command = setNote(document, "tab-0", rect);
      if (command.type === C.SetNote || command.type === C.SetNotesInRect) command.inheritNumberedRhythm = !explicit;
      const result = applyScoreCommand(document, command);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.document.score.tracks[0]!.measures[0]!.beats[0]!.rhythm).toEqual({ base: "quarter", dots: 0 });
    }
  });

  it("多拍矩形保持原节奏和选区语义", () => {
    const document = numberedFirstDocument();
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const result = applyScoreCommand(document, {
      type: C.SetNotesInRect, fret: 3,
      range: { trackId: track.id, anchor: { measureId: measure.id, beatId: "tab-0", string: 1 }, focus: { measureId: measure.id, beatId: "tab-1", string: 2 } },
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const beats = result.document.score.tracks[0]!.measures[0]!.beats;
    expect(beats.map((beat) => [beat.tick, beat.rhythm])).toEqual(measure.beats.map((beat) => [beat.tick, beat.rhythm]));
    expect(beats.slice(0, 2).map((beat) => beat.notes.length)).toEqual([2, 2]);
  });

  it.each([false, true])("首次输入原子继承附点、细分余量并逐个填完（rect=%s）", (rect) => {
    const original = numberedFirstDocument();
    let document = original;
    const numbered = structuredClone(original.score.tracks[0]!.measures[0]!.numberedVoice);
    for (const tick of [0, 720, 960, 2880]) {
      const beat = document.score.tracks[0]!.measures[0]!.beats.find((b) => b.tick === tick);
      expect(beat, `tick ${tick} must remain available for input`).toBeDefined();
      const result = applyScoreCommand(document, setNote(document, beat!.id, rect));
      expect(result).toMatchObject({ ok: true, changed: true });
      if (!result.ok) return;
      expect(result.document.documentRevision).toBe(document.documentRevision + 1);
      document = result.document;
      if (tick === 0) {
        expect(document.score.tracks[0]!.measures[0]!.beats[0]!.rhythm).toEqual({ base: "eighth", dots: 1 });
        expect(document.score.tracks[0]!.measures[0]!.beats[1]).toMatchObject({ tick: 720, kind: "notes", notes: [], rhythm: { base: "sixteenth", dots: 0 } });
        const layout = buildLayout(document, { systemWidth: 733, density: "compact" });
        const measureLayout = layout.systems[0]!.measures[0]!;
        const slot = document.score.tracks[0]!.measures[0]!.beats[1]!;
        const slotLayout = measureLayout.beats.find((b) => b.id === slot.id)!;
        expect(hitTestLayout(layout, { x: slotLayout.x, y: measureLayout.strings[0]!.y1 })).toMatchObject({ beatId: slot.id, string: 1 });
      }
    }
    const measure = document.score.tracks[0]!.measures[0]!;
    expect(measure.beats.map((b) => [b.tick, b.rhythm, b.notes.length])).toEqual([
      [0, { base: "eighth", dots: 1 }, 1], [720, { base: "sixteenth", dots: 0 }, 1],
      [960, { base: "half", dots: 0 }, 1], [2880, { base: "quarter", dots: 0 }, 1],
    ]);
    expect(measure.numberedVoice).toEqual(numbered);
    expect(measure.beats.find((b) => b.tick === 2880)?.id).toBe("tab-3");
    expect(original.score.tracks[0]!.measures[0]!.beats).toHaveLength(4);
  });
});
