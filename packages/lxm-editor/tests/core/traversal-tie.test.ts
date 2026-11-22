import { describe, expect, it } from "vitest";
import { applyScoreCommand, LXMScoreCommandEnum as C, type ILXMScoreCommand } from "../../src/core/commands/commands";
import { STANDARD_GUITAR_TUNING } from "../../src/core/constants";
import { loadDocument } from "../../src/core/document/loader";
import { createBeatClipboard, planBeatPaste } from "../../src/core/rhythm/beat-clipboard";
import { planRhythmPattern } from "../../src/core/rhythm/rhythm-pattern";
import { pruneInvalidTechniques, validateTechnique } from "../../src/core/techniques/technique-rules";
import type { ILXMDocument, ILXMMeasure, ILXMTechniqueDraft } from "../../src/core/types";

const measure = (id: string): ILXMMeasure => ({
  id, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
  lyrics: [], chordSymbols: [], tuplets: [], numberedVoice: { events: [], tuplets: [] },
  beats: Array.from({ length: 4 }, (_, i) => ({
    id: `${id}-${i}`, tick: i * 960, kind: "rest", rhythm: { base: "quarter", dots: 0 }, notes: [],
  })),
});
const fixture = (fromBeatId = "a-0", toBeatId = "a-1") => {
  const document: ILXMDocument = { schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
    score: { id: "score", title: "连续扫弦", arranger: "", keySignature: "C", meta: {}, tracks: [{
      id: "track", name: "吉他", instrument: "guitar", capo: 0, startBarline: "none",
      tuning: { strings: STANDARD_GUITAR_TUNING.map((string) => ({ ...string })) },
      measures: [measure("a"), measure("b")], numberedMarks: [], techniques: [
        { id: "source", type: "strum", beatId: fromBeatId, minString: 1, maxString: 3, stroke: "up" },
        { id: "destination", type: "arpeggio", beatId: toBeatId, minString: 3, maxString: 6, direction: "ascending" },
      ],
    }] } };
  const track = document.score.tracks[0]!;
  const draft = { type: "traversalTie", fromBeatId, toBeatId } satisfies ILXMTechniqueDraft;
  return { document, track, draft };
};
const execute = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(`${result.code} ${result.message}`);
  return result;
};
const addTie = (data = fixture()) => execute(data.document,
  { type: C.AddTechnique, trackId: data.track.id, technique: data.draft }).document;

describe("扫弦/琶音延音线", () => {
  it.each(["rest", "notes"] as const)("保留两端无音符的 %s 拍，支持单弦交集、往返加载和重复新增", (kind) => {
    const data = fixture();
    for (const beat of data.track.measures[0]!.beats.slice(0, 2)) beat.kind = kind;
    const tied = addTie(data);
    expect(tied.score.tracks[0]!.measures).toBe(data.track.measures);
    expect(tied.score.tracks[0]!.techniques).toEqual([...data.track.techniques, { ...data.draft, id: expect.any(String) }]);
    expect(loadDocument(JSON.stringify(tied))).toEqual({ ok: true, document: tied });
    expect(execute(tied, { type: C.AddTechnique, trackId: data.track.id, technique: data.draft })).toEqual({ ok: true, changed: false, document: tied });
    const duplicate = structuredClone(tied);
    duplicate.score.tracks[0]!.techniques.push({ ...data.draft, id: "duplicate" });
    expect(loadDocument(JSON.stringify(duplicate)).ok).toBe(false);
  });

  it("拒绝缺失端点、逆序、非相邻、没有扫弦、没有公共弦及两端均有逐弦音符", () => {
    const { track, draft } = fixture();
    const validate = (patch: Partial<typeof draft> = {}) => validateTechnique(track, { ...draft, ...patch });
    expect(validate({ fromBeatId: "missing" })).toMatchObject({ ok: false, error: { code: "TECHNIQUE_BEAT_NOT_FOUND", field: "fromBeatId" } });
    expect(validate({ fromBeatId: "a-1", toBeatId: "a-0" })).toMatchObject({ ok: false, error: { code: "TECHNIQUE_NOTES_NOT_ORDERED" } });
    expect(validate({ toBeatId: "a-2" })).toMatchObject({ ok: false, error: { message: expect.stringContaining("相邻") } });
    const destination = track.techniques.pop()!;
    expect(validate()).toMatchObject({ ok: false, error: { message: expect.stringContaining("两端必须") } });
    track.techniques.push({ ...destination, type: "arpeggio", beatId: "a-1", direction: "ascending", minString: 4, maxString: 6 });
    expect(validate()).toMatchObject({ ok: false, error: { code: "TECHNIQUE_REQUIRES_SAME_STRING" } });
    track.measures[0]!.beats.slice(0, 2).forEach((beat) => {
      beat.kind = "notes";
      beat.notes = [{ id: `${beat.id}-note`, string: 3, fret: 0 }];
    });
    expect(validate()).toMatchObject({ ok: false, error: { message: expect.stringContaining("逐弦延音线") } });
  });

  it("允许跨小节和共享中间拍的相邻连接，独立于 P.M. 与 Let Ring 的校验", () => {
    const data = fixture("a-3", "b-0");
    const middle = data.track.measures[1]!.beats[0]!;
    middle.kind = "notes";
    middle.notes = [{ id: "middle-note", string: 3, fret: 0 }];
    data.track.techniques.push({ id: "third", type: "strum", beatId: "b-1", minString: 3, maxString: 6, stroke: "down" });
    let document = addTie(data);
    document = execute(document, { type: C.AddTechnique, trackId: data.track.id,
      technique: { type: "traversalTie", fromBeatId: "b-0", toBeatId: "b-1" } }).document;
    document = execute(document, { type: C.AddTechnique, trackId: data.track.id,
      technique: { type: "letRing", fromBeatId: "b-0", toBeatId: "b-0" } }).document;
    expect(document.score.tracks[0]!.techniques.filter((technique) => technique.type === "traversalTie")).toHaveLength(2);
    const track = document.score.tracks[0]!;
    expect(validateTechnique(track, { type: "palmMute", fromBeatId: "b-0", toBeatId: "b-0" })).toMatchObject({ ok: false, error: { code: "TECHNIQUE_CONFLICT" } });
    expect(validateTechnique(track, { type: "letRing", fromBeatId: "a-3", toBeatId: "b-0" })).toMatchObject({ ok: false, error: { message: expect.stringContaining("休止 Beat") } });
  });

  it("保留仍重叠的替换，原子清理失效连接，并拒绝将支撑技巧更新为自依赖连接", () => {
    const data = fixture();
    const tied = addTie(data);
    const tie = tied.score.tracks[0]!.techniques.at(-1)!;
    const update = (minString: number, maxString: number): ILXMScoreCommand => ({
      type: C.AddTechnique, trackId: data.track.id,
      technique: { type: "strum", beatId: "a-1", minString, maxString, stroke: "down" },
    });
    const validReplacement = execute(tied, update(2, 5));
    expect(validReplacement.document.score.tracks[0]!.techniques.at(-1)).toBe(tie);
    for (const command of [
      update(4, 6),
      { type: C.RemoveTechnique, trackId: data.track.id, techniqueId: "source" },
      { type: C.SetNote, trackId: data.track.id, measureId: "a", beatId: "a-0", string: 1, fret: 2 },
    ] as const) {
      const result = execute(tied, command);
      expect(result.document.documentRevision).toBe(tied.documentRevision + 1);
      expect(result.document.score.tracks[0]!.techniques).not.toContain(tie);
      expect(result.effects).toContainEqual(expect.objectContaining({ kind: "technique.removed", techniqueId: tie.id, techniqueType: "traversalTie" }));
    }
    expect(applyScoreCommand(data.document, { type: C.UpdateTechnique, trackId: data.track.id,
      techniqueId: "source", technique: data.draft })).toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });
  });

  it("保留序列化顺序无关的连接，并在插入小节破坏邻接时清理", () => {
    const data = fixture("a-3", "b-0");
    const tied = addTie(data);
    const track = tied.score.tracks[0]!;
    track.techniques.reverse();
    expect(pruneInvalidTechniques(track)).toBe(track);
    const result = execute(tied, { type: C.InsertMeasure, trackId: track.id, afterMeasureId: "a" });
    expect(result.document.score.tracks[0]!.techniques).toEqual(track.techniques.slice(1));
    expect(result.effects).toContainEqual(expect.objectContaining({ kind: "technique.removed", techniqueType: "traversalTie" }));
  });

  it("节奏型预览报告失去相邻性的连接，拆分终点保留原扫弦起音", () => {
    const tied = addTie();
    const track = tied.score.tracks[0]!;
    const tie = track.techniques.at(-1)!;
    track.techniques.reverse();
    const target = { layer: "tab", trackId: track.id, measureId: "a", startTick: 0, endTick: 0, focusTick: 0 } as const;
    const plan = planRhythmPattern(tied, target, "eight-sixteen");
    expect(plan).toMatchObject({ ok: true, removedMarks: [{ id: tie.id, type: "traversalTie", crossesScope: true }] });
    const split = execute(tied, { type: C.SplitBeat, trackId: track.id, measureId: "a", beatId: "a-1" });
    expect(split.document.score.tracks[0]!.techniques).toEqual(track.techniques);
    expect(applyScoreCommand(tied, { type: C.SplitBeat, trackId: track.id, measureId: "a", beatId: "a-0" })).toMatchObject({ ok: false, code: "INVALID_BEAT_OPERATION" });
  });

  it("复制小节和拍点时重映射完整连接，裁掉一端时记录遗漏", () => {
    const tied = addTie();
    const original = tied.score.tracks[0]!;
    const copied = execute(tied, { type: C.CopyMeasure, trackId: original.id, measureId: "a" }).document.score.tracks[0]!;
    const [from, to] = copied.measures[1]!.beats;
    expect(copied.techniques.slice(3)).toEqual([
      expect.objectContaining({ type: "strum", beatId: from!.id }),
      expect.objectContaining({ type: "arpeggio", beatId: to!.id }),
      expect.objectContaining({ type: "traversalTie", fromBeatId: from!.id, toBeatId: to!.id }),
    ]);
    const range = { trackId: original.id, measureId: "a", startBeatId: "a-0", endBeatId: "a-1", layers: "tab" } as const;
    const full = createBeatClipboard(tied, range);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const pasted = planBeatPaste(tied, { trackId: original.id, measureId: "b", beatId: "b-2", mode: "overwrite" }, full.clipboard);
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const [pasteFrom, pasteTo] = pasted.track.measures[1]!.beats.slice(2);
    expect(pasted.track.techniques.at(-1)).toMatchObject({ type: "traversalTie", fromBeatId: pasteFrom!.id, toBeatId: pasteTo!.id });
    const partial = createBeatClipboard(tied, { ...range, endBeatId: range.startBeatId });
    expect(partial).toMatchObject({ ok: true, clipboard: { omissions: [expect.objectContaining({ kind: "technique.omitted", techniqueType: "traversalTie" })] } });
  });
});
