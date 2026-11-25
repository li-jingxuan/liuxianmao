import { describe, expect, it } from "vitest";
import DEFAULT_MOCK_DOCUMENT from "../../example/default-score";
import { applyScoreCommand, LXMScoreCommandEnum as C, type ILXMScoreCommand } from "../../src/core/commands/commands";
import { TICKS_PER_QUARTER as Q } from "../../src/core/constants";
import { loadDocument } from "../../src/core/document/loader";
import { LXMBeatSchema, LXMDocumentSchema } from "../../src/core/document/schema";
import { validateDocumentSemantics } from "../../src/core/document/semantic-validation";
import { planRhythmPattern, type RhythmPatternTarget } from "../../src/core/rhythm/rhythm-pattern";
import { tabInputRhythmFromNumbered } from "../../src/core/rhythm/tab-input-rhythm";
import type { ILXMBeat, ILXMDocument, ILXMRhythm } from "../../src/core/types";

const beat = (id: string, tick: number, base: ILXMRhythm["base"] = "quarter", preserve = false): ILXMBeat => ({
  id, tick, rhythm: { base, dots: 0 }, kind: "notes", notes: [], ...(preserve ? { preserveInputRhythm: true as const } : {}),
});
const fixture = () => {
  const document = structuredClone(DEFAULT_MOCK_DOCUMENT);
  const track = document.score.tracks[0]!;
  document.score.tracks = [track];
  const measure = track.measures[0]!;
  track.measures = [measure];
  delete track.playbackReplay;
  delete track.repeatEndingGroups;
  track.techniques = [];
  track.numberedMarks = [];
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.tuplets = [];
  measure.beats = Array.from({ length: 4 }, (_, i) => beat(`tab-${i}`, i * Q));
  // 同tick简谱长音会尝试吞掉模板的多个空拍，直接复现默认继承路径。
  measure.numberedVoice = { tuplets: [], events: [0, Q * 2].map((tick, i) => ({
    id: `numbered-${i}`, tick, kind: "notes", rhythm: { base: "half", dots: 0 }, items: [{ id: `numbered-item-${i}`, token: "1" }],
  })) };
  measure.lyrics = ([1, 2, 3, 4] as const).map(verse => ({ id: `lyric-${verse}`, eventId: "numbered-0", verse, text: `风${verse}` }));
  measure.chordSymbols = [{ id: "outside-chord", beatId: "tab-3", display: "name", chord: { name: "C", diagram: null } }];
  const target: RhythmPatternTarget = { layer: "tab", trackId: track.id, measureId: measure.id, startTick: 0, endTick: 0, focusTick: 0 };
  return { document, track, measure, target };
};
const execute = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  expect(validateDocumentSemantics(result.document)).toEqual({ ok: true });
  return result;
};
const preview = (document: ILXMDocument, target: RhythmPatternTarget, template = "eight-sixteen") => {
  const plan = planRhythmPattern(document, target, template);
  if (!plan.ok) throw new Error(plan.message);
  return plan;
};
const apply = (document: ILXMDocument, target: RhythmPatternTarget, template = "eight-sixteen") => {
  const plan = preview(document, target, template);
  return execute(document, { type: C.ApplyRhythmPattern, target, templateId: template, expectedConfirmationKey: plan.confirmationKey });
};
const reload = (document: ILXMDocument) => {
  const loaded = loadDocument(JSON.stringify(document));
  if (!loaded.ok) throw new Error(loaded.errors.join("、"));
  return loaded.document;
};
const input = (document: ILXMDocument, beatId: string, rect: boolean): ILXMScoreCommand => {
  const track = document.score.tracks[0]!, measure = track.measures[0]!;
  return rect ? { type: C.SetNotesInRect, range: { trackId: track.id,
    anchor: { measureId: measure.id, beatId, string: 1 }, focus: { measureId: measure.id, beatId, string: 6 } }, fret: 3 }
    : { type: C.SetNote, trackId: track.id, measureId: measure.id, beatId, string: 1, fret: 3 };
};

describe("节奏型TAB空位持久化补音时值", () => {
  it.each([false, true])("模板apply后保存重载，默认补音保留所有模板位置和时值（单beat矩形=%s）", rect => {
    const { document, target, measure } = fixture();
    const before = structuredClone(document);
    const p = preview(document, target);
    const planned = p.track.measures[0]!;
    expect(p.after.every(event => "preserveInputRhythm" in event && event.preserveInputRhythm)).toBe(true);
    expect(p.perBeat[0]!.after).toEqual(p.after);
    expect(planned.beats.slice(0, 3)).toEqual(p.after);
    expect(planned.beats[3]).toBe(measure.beats[1]);
    expect(document).toEqual(before);
    let loaded = reload(apply(document, target).document);
    const structure = loaded.score.tracks[0]!.measures[0]!.beats.map(b => ({ id: b.id, tick: b.tick, rhythm: b.rhythm, preserveInputRhythm: b.preserveInputRhythm }));
    expect(structure.slice(0, 3).map(b => b.tick)).toEqual([0, Q / 2, Q * 3 / 4]);
    for (const position of structure.slice(0, 3)) {
      const t = loaded.score.tracks[0]!, m = t.measures[0]!;
      expect(tabInputRhythmFromNumbered(t, m, position.id)).toBeUndefined();
      const result = execute(loaded, input(loaded, position.id, rect));
      const next = result.document.score.tracks[0]!.measures[0]!;
      expect(next.beats.map(b => ({ id: b.id, tick: b.tick, rhythm: b.rhythm, preserveInputRhythm: b.preserveInputRhythm }))).toEqual(structure);
      expect(next.beats.find(b => b.id === position.id)!.notes).toHaveLength(rect ? 6 : 1);
      expect(next.numberedVoice).toEqual(measure.numberedVoice);
      expect(next.lyrics).toEqual(measure.lyrics);
      expect(next.chordSymbols).toEqual(measure.chordSymbols);
      expect(next.beats.slice(3)).toEqual(measure.beats.slice(1));
      loaded = reload(result.document);
    }
  });

  it.each([false, true])("前方普通空拍不能继承长简谱吞掉后续受保护空拍（单beat矩形=%s）", rect => {
    const { document, target } = fixture();
    const secondBeat = { ...target, startTick: Q, endTick: Q, focusTick: Q };
    const applied = reload(apply(document, secondBeat).document);
    const track = applied.score.tracks[0]!, measure = track.measures[0]!;
    expect(measure.beats[0]!.preserveInputRhythm).toBeUndefined();
    expect(measure.beats[1]!.preserveInputRhythm).toBe(true);
    expect(tabInputRhythmFromNumbered(track, measure, "tab-0")).toBeUndefined();
    const result = execute(applied, input(applied, "tab-0", rect));
    const next = result.document.score.tracks[0]!.measures[0]!;
    expect(next.beats[0]).toMatchObject({ id: "tab-0", tick: 0, rhythm: { base: "quarter", dots: 0 } });
    expect(next.beats.slice(1)).toEqual(measure.beats.slice(1));
    expect(next.numberedVoice).toEqual(measure.numberedVoice);
  });

  it("无flag的既有相同空位模板保持noop，不为增加flag创建revision/history", () => {
    const { document, measure, target } = fixture();
    measure.beats.splice(0, 1, beat("tab-0", 0, "eighth"), beat("gap-a", Q / 2, "sixteenth"), beat("gap-b", Q * 3 / 4, "sixteenth"));
    const p = preview(document, target);
    expect(p.changed).toBe(false);
    expect(p.track).toBe(document.score.tracks[0]);
    expect(p.after.every(e => !("preserveInputRhythm" in e))).toBe(true);
    const r = apply(document, target);
    expect(r.changed).toBe(false);
    expect(r.document).toBe(document);
    expect(r.document.documentRevision).toBe(document.documentRevision);
  });

  it("带flag空位重载再套同模板noop，重新排布保留已有flag与范围外原结构", () => {
    const { document, target } = fixture();
    const loaded = reload(apply(document, target).document);
    const same = apply(loaded, target);
    expect(same.changed).toBe(false);
    expect(same.document).toBe(loaded);
    const before = loaded.score.tracks[0]!.measures[0]!;
    const changed = apply(loaded, target, "sixteen-eight").document;
    const next = changed.score.tracks[0]!.measures[0]!;
    expect(next.beats.slice(0, 3).map(b => b.preserveInputRhythm)).toEqual([true, true, true]);
    expect(next.beats.slice(0, 3).map(b => b.tick)).toEqual([0, Q / 4, Q / 2]);
    expect(next.beats.slice(3)).toEqual(before.beats.slice(3));
    expect(next.numberedVoice).toBe(before.numberedVoice);
    expect(next.lyrics).toBe(before.lyrics);
    expect(next.chordSymbols).toBe(before.chordSymbols);
    expect(apply(reload(changed), target, "sixteen-eight").changed).toBe(false);
  });

  it.each([false, true])("跨scope纯空拍切分仅继承源flag，范围外不自动新增（原flag=%s）", preserve => {
    const { document, measure, target } = fixture();
    measure.chordSymbols = [];
    measure.beats = [beat("whole-gap", 0, "whole", preserve)];
    const p = preview(document, { ...target, startTick: Q, endTick: Q, focusTick: Q });
    const result = p.track.measures[0]!.beats;
    const outside = result.filter(b => b.tick < Q || b.tick >= Q * 2);
    expect(outside.map(b => b.preserveInputRhythm)).toEqual([preserve || undefined, preserve || undefined]);
    expect(result.filter(b => b.tick >= Q && b.tick < Q * 2).every(b => b.preserveInputRhythm)).toBe(true);
    expect(result[0]).toMatchObject({ id: "whole-gap", tick: 0, rhythm: { base: "quarter", dots: 0 } });
    expect(result.at(-1)).toMatchObject({ tick: Q * 2, rhythm: { base: "half", dots: 0 } });
  });

  it("strict schema兼容旧beat、允许literal true，拒绝false或其他类型", () => {
    const old = beat("old", 0);
    expect(LXMBeatSchema.safeParse(old).success).toBe(true);
    expect(LXMBeatSchema.safeParse({ ...old, preserveInputRhythm: true }).success).toBe(true);
    for (const value of [false, "true", 1, null]) expect(LXMBeatSchema.safeParse({ ...old, preserveInputRhythm: value }).success).toBe(false);
  });

  it.each([false, true])("模板补音、删除全部内容再保存重填，flag和时值保持（矩形=%s）", rect => {
    const { document, target, measure } = fixture();
    let current = reload(apply(document, target).document);
    const positions = current.score.tracks[0]!.measures[0]!.beats.slice(0, 3).map(b => ({
      id: b.id, tick: b.tick, rhythm: b.rhythm, preserveInputRhythm: b.preserveInputRhythm,
    }));
    for (let round = 0; round < 3; round++) {
      // 每轮填入后全部清除，再重载并换一种输入入口，覆盖flag随内容编辑丢失的风险。
      for (const position of positions) {
        const filled = execute(current, input(current, position.id, round % 2 ? !rect : rect));
        const track = filled.document.score.tracks[0]!, next = track.measures[0]!;
        const cell = { measureId: next.id, beatId: position.id, string: 1 };
        const removed = execute(filled.document, rect ? {
          type: C.RemoveNotesInRect, range: { trackId: track.id, anchor: cell, focus: { ...cell, string: 6 } },
        } : {
          type: C.RemoveNotesInRect, range: { trackId: track.id, anchor: { ...cell, string: 6 }, focus: cell },
        });
        current = reload(removed.document);
        expect(LXMDocumentSchema.safeParse(current).success).toBe(true);
        const m = current.score.tracks[0]!.measures[0]!;
        expect(m.beats.find(b => b.id === position.id)!.notes).toEqual([]);
        expect(m.beats.slice(0, 3).map(b => ({ id: b.id, tick: b.tick, rhythm: b.rhythm, preserveInputRhythm: b.preserveInputRhythm }))).toEqual(positions);
        expect(m.beats.slice(3)).toEqual(measure.beats.slice(1));
        expect(m.numberedVoice).toEqual(measure.numberedVoice);
        expect(m.lyrics).toEqual(measure.lyrics);
        expect(m.chordSymbols).toEqual(measure.chordSymbols);
        expect(tabInputRhythmFromNumbered(current.score.tracks[0]!, m, position.id)).toBeUndefined();
      }
      const reapplied = apply(current, target);
      expect(reapplied.changed).toBe(false);
      expect(reapplied.document).toBe(current);
      const refilled = execute(current, input(current, positions[0]!.id, rect));
      expect(refilled.document.score.tracks[0]!.measures[0]!.beats.slice(0, 3).map(b => ({
        id: b.id, tick: b.tick, rhythm: b.rhythm, preserveInputRhythm: b.preserveInputRhythm,
      }))).toEqual(positions);
      // 下一轮再次覆盖并清空，避免只验证首次输入。
      current = reload(refilled.document);
    }
  });

  it("已有受保护内容重排后删除成空位，保存重载仍禁止继承简谱长音", () => {
    const { document, target } = fixture();
    const applied = apply(document, target).document;
    const first = applied.score.tracks[0]!.measures[0]!.beats[0]!;
    const filled = execute(applied, input(applied, first.id, false)).document;
    const rearranged = apply(filled, target, "sixteen-eight").document;
    const track = rearranged.score.tracks[0]!, measure = track.measures[0]!;
    const removed = execute(rearranged, { type: C.RemoveNote, trackId: track.id, measureId: measure.id, beatId: first.id, string: 1 }).document;
    const loaded = reload(removed);
    const after = loaded.score.tracks[0]!.measures[0]!;
    expect(after.beats[0]).toMatchObject({ id: first.id, rhythm: { base: "sixteenth", dots: 0 }, notes: [], preserveInputRhythm: true });
    expect(tabInputRhythmFromNumbered(loaded.score.tracks[0]!, after, first.id)).toBeUndefined();
    const refilled = execute(loaded, input(loaded, first.id, true)).document;
    expect(refilled.score.tracks[0]!.measures[0]!.beats.map(b => [b.id, b.tick, b.rhythm, b.preserveInputRhythm]))
      .toEqual(after.beats.map(b => [b.id, b.tick, b.rhythm, b.preserveInputRhythm]));
  });
});
