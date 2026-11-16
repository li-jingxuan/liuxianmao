import { describe, expect, it } from "vitest";
import { applyScoreCommand, LXMScoreCommandEnum as C } from "../../src/core/commands/commands";
import { STANDARD_GUITAR_TUNING, TICKS_PER_QUARTER as Q } from "../../src/core/constants";
import { LXMDocumentSchema } from "../../src/core/document/schema";
import { validateDocumentSemantics } from "../../src/core/document/semantic-validation";
import { loadDocument } from "../../src/core/document/loader";
import { calculateRhythmTicks } from "../../src/core/rhythm/rhythm";
import { getRhythmPatternTemplates, planRhythmPattern, RHYTHM_PATTERN_TEMPLATES, type RhythmPatternTarget } from "../../src/core/rhythm/rhythm-pattern";
import type { ILXMBeat, ILXMDocument, ILXMNumberedEvent, ILXMRhythm } from "../../src/core/types";

const rhythm = (base: ILXMRhythm["base"] = "quarter", dots = 0): ILXMRhythm => ({ base, dots });
const event = (id: string, tick: number, r = rhythm(), kind: ILXMNumberedEvent["kind"] = "notes", tokens = ["1"]): ILXMNumberedEvent =>
  kind === "gap" ? { id, tick, kind, rhythm: r, items: [] }
    : { id, tick, kind, rhythm: r, items: (kind === "rest" ? ["0"] : kind === "continuation" ? ["-"] : tokens).map((token, i) => ({ id: `${id}-i${i}`, token })) };
const beat = (id: string, tick: number, r = rhythm(), frets: (number | "-")[] = []): ILXMBeat =>
  ({ id, tick, kind: "notes", rhythm: r, notes: frets.map((fret, i) => ({ id: `${id}-n${i}`, string: i + 1, fret })) });
const fixture = () => {
  const document: ILXMDocument = { schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
    score: { id: "score", title: "节奏型", arranger: "", keySignature: "C", meta: {}, tracks: [{ id: "track", name: "吉他", instrument: "guitar",
      tuning: { strings: STANDARD_GUITAR_TUNING.map(s => ({ ...s })) }, capo: 0, startBarline: "none", techniques: [], numberedMarks: [],
      measures: [{ id: "measure", timeSignature: { numerator: 4, denominator: 4 }, barline: "single", lyrics: [], chordSymbols: [], tuplets: [],
        numberedVoice: { events: [event("e0", 0), event("e1", Q), event("e2", Q * 2), event("e3", Q * 3)], tuplets: [] },
        beats: [beat("b0", 0, rhythm(), [3]), beat("b1", Q, rhythm(), [3]), beat("b2", Q * 2), beat("b3", Q * 3)] }],
    }] } };
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const target: RhythmPatternTarget = { layer: "numbered", trackId: track.id, measureId: measure.id, startTick: 0, endTick: 0, focusTick: 0 };
  return { document, track, measure, target };
};
const plan = (d: ILXMDocument, target: RhythmPatternTarget, templateId = "eight-sixteen") => {
  const result = planRhythmPattern(d, target, templateId);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
};
const commit = (d: ILXMDocument, target: RhythmPatternTarget, templateId = "eight-sixteen", allowRemoveMarks = false) => {
  const p = plan(d, target, templateId);
  const result = applyScoreCommand(d, { type: C.ApplyRhythmPattern, target, templateId, expectedConfirmationKey: p.confirmationKey, allowRemoveMarks });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  expect(LXMDocumentSchema.safeParse(result.document).success).toBe(true);
  expect(validateDocumentSemantics(result.document)).toEqual({ ok: true });
  return result;
};

describe("REQ043 逐拍纯 planner", () => {
  it("单音保留一次、补两个 gap，纯规划无副作用，范围外及另一谱层共享原结构", () => {
    const { document, target, track, measure } = fixture();
    const snapshot = structuredClone(document);
    const p = plan(document, target);
    expect(p.scope).toMatchObject({ startTick: 0, endTick: Q, beatCount: 1 });
    expect(p.after.map(e => [e.tick, e.kind, e.rhythm])).toEqual([[0, "notes", rhythm("eighth")], [Q / 2, "gap", rhythm("sixteenth")], [Q * 3 / 4, "gap", rhythm("sixteenth")]]);
    expect(p.after[0]).toMatchObject({ id: "e0", items: measure.numberedVoice.events[0]!.items });
    expect(p.perBeat[0]).toMatchObject({ retainedCount: 1, gapCount: 2 });
    const next = p.track.measures[0]!;
    expect(next.beats).toBe(measure.beats);
    expect(next.chordSymbols).toBe(measure.chordSymbols);
    expect(next.numberedVoice.events[3]).toBe(measure.numberedVoice.events[1]);
    expect(p.track.techniques).toBe(track.techniques);
    expect(document).toEqual(snapshot);
  });

  it("两音按时间顺序映射、多个同拍复音仅算一个内容", () => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events.splice(0, 1, event("a", 0, rhythm("eighth"), "notes", ["#4'", "3", "5"]), event("b", Q / 2, rhythm("eighth"), "notes", ["6."]));
    const p = plan(document, target);
    expect(p.perBeat[0]!.retainedCount).toBe(2);
    expect(p.after.map(e => e.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(p.after[1]).toMatchObject({ tick: Q / 2, rhythm: rhythm("sixteenth"), items: [{ id: "b-i0", token: "6." }] });
    commit(document, target);
  });

  it.each(["rest", "continuation"] as const)("已有%s仅保留一次，其余空位不伪造音或Tie", kind => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events[0] = event("special", 0, rhythm(), kind);
    const p = plan(document, target);
    expect(p.after.map(e => e.kind)).toEqual([kind, "gap", "gap"]);
    expect(p.removedMarks).toEqual([]);
    commit(document, target);
  });

  it("纯gap和隐式空窗不占名额，音符跨拍范围内按起点仅保留一次", () => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events = [event("gap", 0, rhythm("sixteenth"), "gap"), event("sound", Q / 2, rhythm("quarter"))];
    const t = { ...target, endTick: Q * 2 };
    const p = plan(document, t);
    expect(p.perBeat.map(b => [b.retainedCount, b.gapCount])).toEqual([[1, 2], [0, 3]]);
    expect(p.after[0]!.id).toBe("sound");
    expect(p.after.filter(e => e.kind === "notes")).toHaveLength(1);
    commit(document, t);
  });

  it("带歌词gap和全部四段歌词跟原eventID，纯gap可被重排", () => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events.splice(0, 1, event("blank", 0, rhythm("sixteenth"), "gap"), event("lyricgap", Q / 4, rhythm("sixteenth"), "gap"), event("sound", Q / 2, rhythm("eighth")));
    measure.lyrics = ([1, 2, 3, 4] as const).map(verse => ({ id: `l${verse}`, eventId: "lyricgap", verse, text: `词${verse}` }));
    const p = plan(document, target);
    expect(p.after.slice(0, 2).map(e => [e.id, e.tick])).toEqual([["lyricgap", 0], ["sound", Q / 2]]);
    expect(p.track.measures[0]!.lyrics).toBe(measure.lyrics);
    const r = commit(document, target);
    expect(loadDocument(JSON.stringify(r.document))).toMatchObject({ ok: true });
  });

  it("零长度及不足一拍范围按焦点归拍，足一拍向外覆盖首末拍", () => {
    const { document, target } = fixture();
    expect(plan(document, { ...target, startTick: Q / 2, endTick: Q / 2, focusTick: Q / 2 }).scope).toMatchObject({ startTick: 0, endTick: Q });
    expect(plan(document, { ...target, startTick: Q * 3 / 4, endTick: Q * 5 / 4, focusTick: Q * 5 / 4 }).scope).toMatchObject({ startTick: Q, endTick: Q * 2 });
    expect(plan(document, { ...target, startTick: Q / 2, endTick: Q * 3 / 2 }).scope).toMatchObject({ startTick: 0, endTick: Q * 2 });
  });

  it("17模板与三十二分ticks精确，3/4重复三拍，6/8重复两拍", () => {
    expect(RHYTHM_PATTERN_TEMPLATES).toHaveLength(17);
    expect(getRhythmPatternTemplates({ numerator: 4, denominator: 4 })).toHaveLength(12);
    expect(getRhythmPatternTemplates({ numerator: 6, denominator: 8 })).toHaveLength(5);
    for (const signature of [{ numerator: 4, denominator: 4 }, { numerator: 3, denominator: 4 }, { numerator: 6, denominator: 8 }]) {
      for (const t of getRhythmPatternTemplates(signature)) {
        const { document, target, measure } = fixture();
        measure.timeSignature = signature;
        const count = signature.numerator === 4 ? 4 : signature.numerator === 3 ? 3 : 2;
        measure.beats = Array.from({ length: count }, (_, i) => beat(`tab-${i}`, i * t.beatTicks, signature.denominator === 8 ? rhythm("quarter", 1) : rhythm()));
        measure.numberedVoice.events = [];
        const range = { ...target, endTick: count * t.beatTicks };
        const p = plan(document, range, t.id);
        expect(p.perBeat).toHaveLength(count);
        expect(p.after.every(e => Number.isInteger(e.tick))).toBe(true);
        const durations = p.after.map(e => calculateRhythmTicks(e.rhythm));
        expect(durations.every(d => d.ok)).toBe(true);
        expect(durations.reduce((sum, d) => sum + (d.ok ? d.ticks : 0), 0)).toBe(count * t.beatTicks);
        if (t.detail) expect(durations.some(d => d.ok && d.ticks === Q / 8)).toBe(true);
        expect(p.track.measures[0]!.numberedVoice.tuplets).toEqual([]);
        commit(document, range, t.id);
      }
    }
  });

  it("逐拍超额整体阻止，不借下一拍空位", () => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events = Array.from({ length: 4 }, (_, i) => event(`e-${i}`, i * Q / 4, rhythm("sixteenth")));
    const before = structuredClone(document);
    expect(planRhythmPattern(document, { ...target, endTick: Q * 2 }, "eight-sixteen")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_OVERFLOW", message: expect.stringContaining("第 1 拍有 4 个内容") });
    expect(document).toEqual(before);
  });

  it.each(["notes", "rest", "continuation", "gap"] as const)("跨scope %s内容保护，扩大完整范围后只保留原实体一次", kind => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events = [event("long", 0, rhythm("half"), kind)];
    if (kind === "gap") measure.lyrics = [{ id: "lyric", eventId: "long", verse: 1, text: "风" }];
    expect(planRhythmPattern(document, { ...target, startTick: Q, endTick: Q, focusTick: Q }, "eight-sixteen")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CROSSING_CONTENT" });
    const p = plan(document, { ...target, endTick: Q * 2 });
    expect(p.after.filter(e => e.id === "long")).toHaveLength(1);
    expect(p.perBeat.map(b => b.retainedCount)).toEqual([1, 0]);
  });

  it("跨范围纯gap只分割范围外部分，不改变其他范围内容", () => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events = [event("longgap", 0, rhythm("whole"), "gap")];
    const t = { ...target, startTick: Q, endTick: Q, focusTick: Q };
    const p = plan(document, t);
    const all = p.track.measures[0]!.numberedVoice.events;
    expect(all[0]).toMatchObject({ id: "longgap", tick: 0, rhythm: rhythm() });
    expect(all.at(-1)).toMatchObject({ tick: Q * 2, rhythm: rhythm("half"), kind: "gap" });
    commit(document, t);
  });

  it("无位置、跨小节、不支持拍号及不匹配模板均不能规划", () => {
    const { document, target, measure } = fixture();
    for (const t of [{ ...target, measureId: "missing" }, { ...target, endTick: Q * 5 }, { ...target, focusTick: Q * 4 }, { ...target, startTick: -1 }])
      expect(planRhythmPattern(document, t, "eight-sixteen").ok).toBe(false);
    expect(planRhythmPattern(document, target, "three-eighths")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_TEMPLATE_MISMATCH" });
    measure.timeSignature = { numerator: 2, denominator: 4 };
    expect(planRhythmPattern(document, target, "quarter")).toMatchObject({ ok: false, code: "UNSUPPORTED_TIME_SIGNATURE" });
  });
});

describe("REQ043 TAB隔离、标记确认与原子命令", () => {
  it("TAB六弦只计一组，和弦空beat也占内容，全部弦品位和chord锚点不变", () => {
    const { document, target, measure } = fixture();
    measure.beats.splice(0, 1, beat("chordgap", 0, rhythm("eighth")), beat("six", Q / 2, rhythm("eighth"), [0, 1, 2, 3, 4, 5]));
    measure.chordSymbols = [{ id: "chord", beatId: "chordgap", display: "name", chord: { name: "C", diagram: null } }];
    const p = plan(document, { ...target, layer: "tab" });
    expect(p.perBeat[0]!.retainedCount).toBe(2);
    expect(p.after[0]!.id).toBe("chordgap");
    expect(p.after[1]).toMatchObject({ id: "six", notes: measure.beats[1]!.notes });
    const next = p.track.measures[0]!;
    expect(next.chordSymbols).toBe(measure.chordSymbols);
    expect(next.numberedVoice).toBe(measure.numberedVoice);
    expect(next.lyrics).toBe(measure.lyrics);
    commit(document, { ...target, layer: "tab" });
  });

  it("TAB休止与延续分别保留一次，纯空beat不计内容，不派生简谱", () => {
    const { document, target, measure } = fixture();
    measure.numberedVoice.events = [];
    measure.beats.splice(0, 2, { ...beat("rest", 0, rhythm("sixteenth")), kind: "rest" }, beat("empty", Q / 4, rhythm("eighth", 1)), beat("continue", Q, rhythm(), ["-", "-"]));
    const t = { ...target, layer: "tab" as const, endTick: Q * 2 };
    const p = plan(document, t, "quarter");
    expect(p.after.map(e => e.kind)).toEqual(["rest", "notes"]);
    expect(p.perBeat.map(b => b.retainedCount)).toEqual([1, 1]);
    expect(p.after[1]).toMatchObject({ id: "continue", notes: measure.beats[2]!.notes });
    expect(p.track.measures[0]!.numberedVoice.events).toEqual([]);
    commit(document, t, "quarter");
  });

  it("TAB跨界音符、休止与带和弦空拍保护；纯空beat可以分割", () => {
    for (const kind of ["notes", "rest", "chord", "empty"]) {
      const { document, target, measure } = fixture();
      measure.beats = [beat("long", 0, rhythm("whole"), kind === "notes" ? [0] : [])];
      if (kind === "rest") measure.beats[0]!.kind = "rest";
      if (kind === "chord") measure.chordSymbols = [{ id: "chord", beatId: "long", display: "name", chord: { name: "C", diagram: null } }];
      const t = { ...target, layer: "tab" as const, startTick: Q, endTick: Q, focusTick: Q };
      if (kind === "empty") commit(document, t);
      else expect(planRhythmPattern(document, t, "eight-sixteen")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CROSSING_CONTENT" });
    }
  });

  it("简谱连接与延长记号列明中文名及ID，跨范围连接只删除关系，TAB标记保持", () => {
    const { document, target, track } = fixture();
    track.numberedMarks = [
      { id: "tie", type: "tie", fromItemId: "e0-i0", toItemId: "e1-i0" },
      { id: "slur", type: "slur", fromEventId: "e0", toEventId: "e2" },
      { id: "fermata", type: "fermata", eventId: "e0" },
      { id: "outside", type: "fermata", eventId: "e3" },
    ];
    track.techniques = [{ id: "tab-vibrato", type: "vibrato", fromNoteId: "b0-n0" }];
    const p = plan(document, target);
    expect(p.removedMarks).toEqual([
      { id: "tie", type: "tie", name: "延音线", crossesScope: true },
      { id: "slur", type: "slur", name: "圆滑线", crossesScope: true },
      { id: "fermata", type: "fermata", name: "延长记号", crossesScope: false },
    ]);
    expect(applyScoreCommand(document, { type: C.ApplyRhythmPattern, target, templateId: "eight-sixteen", expectedConfirmationKey: p.confirmationKey })).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CONFIRMATION_REQUIRED", removedMarkIds: ["tie", "slur", "fermata"] });
    const r = commit(document, target, "eight-sixteen", true);
    const next = r.document.score.tracks[0]!;
    expect(next.techniques).toBe(track.techniques);
    expect(next.numberedMarks.map(m => m.id)).toEqual(["outside"]);
    expect(next.measures[0]!.numberedVoice.events.find(e => e.id === "e1")).toBe(track.measures[0]!.numberedVoice.events[1]);
  });

  it("TAB区间技巧中段相交仍移除，跨界Tie只清连接，范围外及简谱标记保留", () => {
    const { document, target, track, measure } = fixture();
    track.numberedMarks = [{ id: "numbered-fermata", type: "fermata", eventId: "e1" }];
    track.techniques = [
      { id: "pm", type: "palmMute", fromBeatId: "b0", toBeatId: "b3" },
      { id: "ring", type: "letRing", fromBeatId: "b0", toBeatId: "b3" },
      { id: "tie", type: "tie", fromNoteId: "b0-n0", toNoteId: "b1-n0" },
      { id: "outside", type: "vibrato", fromNoteId: "b0-n0" },
    ];
    const t = { ...target, layer: "tab" as const, startTick: Q, endTick: Q, focusTick: Q };
    const p = plan(document, t);
    expect(p.removedMarks.map(m => m.id)).toEqual(["pm", "ring", "tie"]);
    const r = commit(document, t, "eight-sixteen", true);
    expect(r.document.score.tracks[0]!.techniques.map(m => m.id)).toEqual(["outside"]);
    expect(r.document.score.tracks[0]!.numberedMarks).toBe(track.numberedMarks);
    expect(r.document.score.tracks[0]!.measures[0]!.beats[0]).toBe(measure.beats[0]);
  });

  it.each(["numbered", "tab"] as const)("%s完整连音按实际tick映射，需确认清除；部分组阻止", layer => {
    const { document, target, measure } = fixture();
    const ids = ["triplet0", "triplet1", "triplet2"];
    if (layer === "numbered") {
      measure.numberedVoice.events.splice(0, 1, ...ids.map((id, i) => event(id, i * Q / 3, rhythm("eighth"))));
      measure.numberedVoice.tuplets = [{ id: "group", eventIds: ids, ratio: { actual: 3, normal: 2 } }];
    } else {
      measure.beats.splice(0, 1, ...ids.map((id, i) => beat(id, i * Q / 3, rhythm("eighth"), [i])));
      measure.tuplets = [{ id: "group", beatIds: ids, ratio: { actual: 3, normal: 2 } }];
    }
    const t = { ...target, layer };
    const p = plan(document, t);
    expect(p.removedMarks).toContainEqual({ id: "group", type: "tuplet", name: "连音组", crossesScope: false });
    expect(p.beforeDurationTicks.triplet0).toBe(Q / 3);
    expect(p.after.map(e => e.id)).toEqual(ids);
    commit(document, t, "eight-sixteen", true);
    // 写作四分的三连音总长两拍，单拍仅涵盖部分组。
    if (layer === "numbered") {
      measure.numberedVoice.events = ids.map((id, i) => event(id, i * Q * 2 / 3));
    } else {
      measure.beats = [...ids.map((id, i) => beat(id, i * Q * 2 / 3, rhythm(), [i])), beat("remaining", Q * 2, rhythm("half"))];
    }
    expect(planRhythmPattern(document, t, "eight-sixteen")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_PARTIAL_TUPLET" });
    const whole = plan(document, { ...t, endTick: Q * 2 });
    expect(whole.perBeat.map(b => b.retainedCount)).toEqual([2, 1]);
    commit(document, { ...t, endTick: Q * 2 }, "eight-sixteen", true);
  });

  it("标记涉及多小节另一端时只清关系，不触碰外小节", () => {
    const { document, target, track, measure } = fixture();
    const outside = structuredClone(measure);
    outside.id = "outside-measure";
    outside.numberedVoice.events = [event("outside-event", 0)];
    outside.beats = outside.beats.map((b, i) => beat(`outside-beat-${i}`, i * Q));
    track.measures.push(outside);
    track.numberedMarks = [{ id: "long-slur", type: "slur", fromEventId: "e0", toEventId: "outside-event" }];
    const p = plan(document, target);
    expect(p.removedMarks[0]!.crossesScope).toBe(true);
    const r = commit(document, target, "eight-sixteen", true);
    expect(r.document.score.tracks[0]!.measures[1]).toBe(outside);
  });

  it("一次多拍命令仅递增一次revision；重复应用完全noop，保留document引用", () => {
    const { document, target } = fixture();
    const t = { ...target, endTick: Q * 2 };
    const r = commit(document, t);
    expect(r.changed).toBe(true);
    expect(r.document.documentRevision).toBe(document.documentRevision + 1);
    expect(r.nextNumberedFocus).toMatchObject({ eventId: "e0" });
    const again = commit(r.document, t);
    expect(again.changed).toBe(false);
    expect(again.document).toBe(r.document);
    const tab = commit(document, { ...t, layer: "tab" });
    expect(commit(tab.document, { ...t, layer: "tab" }).document).toBe(tab.document);
  });

  it("原本相同节奏的gap不因字段顺序或实体重建产生历史；含标记仍要求确认", () => {
    const { document, target, measure, track } = fixture();
    measure.numberedVoice.events[0] = event("gap", 0, rhythm(), "gap");
    expect(commit(document, target, "quarter")).toMatchObject({ changed: false, document });
    track.numberedMarks = [{ id: "f", type: "fermata", eventId: "e1" }];
    const t = { ...target, startTick: Q, endTick: Q, focusTick: Q };
    expect(plan(document, t, "quarter").changed).toBe(true);
    commit(document, t, "quarter", true);
  });

  it("确认与原始目标、模板、完整文档内容和revision绑定，无法绕过", () => {
    const { document, target } = fixture();
    const p = plan(document, target);
    const cmd = { type: C.ApplyRhythmPattern, target, templateId: "eight-sixteen", expectedConfirmationKey: p.confirmationKey, allowRemoveMarks: true } as const;
    for (const changed of [
      { ...cmd, expectedConfirmationKey: "" },
      { ...cmd, templateId: "eighths" },
      { ...cmd, target: { ...target, focusTick: Q / 2 } },
    ]) expect(applyScoreCommand(document, changed)).toMatchObject({ ok: false, code: "STALE_RHYTHM_PATTERN_PLAN" });
    const sameRevision = structuredClone(document);
    sameRevision.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!.items[0]!.token = "5";
    expect(applyScoreCommand(sameRevision, cmd)).toMatchObject({ ok: false, code: "STALE_RHYTHM_PATTERN_PLAN" });
    expect(applyScoreCommand({ ...document, documentRevision: 2 }, cmd)).toMatchObject({ ok: false, code: "STALE_RHYTHM_PATTERN_PLAN" });
  });
});

describe("REQ043 命令提交与重复保存边界", () => {
  it.each([false, true])("连接两端都在目标外，中间scope仍要求清除关系（跨小节=%s）", crossMeasure => {
    for (const layer of ["numbered", "tab"] as const) {
      const { document, target, track, measure } = fixture();
      measure.beats = [beat("b0", 0, rhythm(), [3]), beat("b1", Q), beat("b2", Q * 2), beat("b3", Q * 3, rhythm(), [5])];
      let toEvent = "e3", toNote = "b3-n0";
      if (crossMeasure) {
        // 两端位于前后小节，处理中间小节；验证绝对时间偏移而非仅命中端点。
        const outside = (id: string) => ({ ...structuredClone(measure), id,
          numberedVoice: { tuplets: [], events: [event(`${id}-event`, 0)] },
          beats: Array.from({ length: 4 }, (_, i) => beat(`${id}-beat${i}`, i * Q, rhythm(), i === 0 ? [5] : [])),
        });
        const before = outside("before"), after = outside("after");
        before.beats[0]!.notes[0]!.fret = 3;
        // 中间小节不含同弦起音，slide 两端因而是同弦相邻真实音。
        measure.beats = Array.from({ length: 4 }, (_, i) => beat(`b${i}`, i * Q));
        track.measures = [before, measure, after];
        toEvent = "after-event";
        toNote = "after-beat0-n0";
      }
      const fromEvent = crossMeasure ? "before-event" : "e0";
      const fromNote = crossMeasure ? "before-beat0-n0" : "b0-n0";
      track.numberedMarks = [{ id: "span-slur", type: "slur", fromEventId: fromEvent, toEventId: toEvent }];
      track.techniques = [{ id: "span-slide", type: "slideUp", fromNoteId: fromNote, toNoteId: toNote }];
      expect(validateDocumentSemantics(document)).toEqual({ ok: true });
      const t = { ...target, layer, startTick: Q, endTick: Q, focusTick: Q };
      const snapshot = structuredClone(document);
      const p = plan(document, t);
      expect(p.removedMarks).toEqual([{ id: layer === "numbered" ? "span-slur" : "span-slide",
        type: layer === "numbered" ? "slur" : "slideUp", name: layer === "numbered" ? "圆滑线" : "上滑音", crossesScope: true }]);
      expect(applyScoreCommand(document, { type: C.ApplyRhythmPattern, target: t, templateId: p.template.id,
        expectedConfirmationKey: p.confirmationKey })).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CONFIRMATION_REQUIRED" });
      expect(document).toEqual(snapshot);
      const next = commit(document, t, p.template.id, true).document.score.tracks[0]!;
      expect(layer === "numbered" ? next.numberedMarks : next.techniques).toEqual([]);
      expect(layer === "numbered" ? next.techniques : next.numberedMarks).toEqual(layer === "numbered" ? track.techniques : track.numberedMarks);
      const changed = next.measures.find(m => m.id === measure.id)!;
      expect(changed.numberedVoice.events.find(e => e.id === "e0")).toBe(measure.numberedVoice.events[0]);
      expect(changed.numberedVoice.events.find(e => e.id === "e3")).toBe(measure.numberedVoice.events[3]);
      expect(changed.beats.find(b => b.id === "b0")).toBe(measure.beats[0]);
      expect(changed.beats.find(b => b.id === "b3")).toBe(measure.beats[3]);
      if (crossMeasure) {
        expect(next.measures[0]).toBe(track.measures[0]);
        expect(next.measures[2]).toBe(track.measures[2]);
      }
    }
  });

  it.each(["numbered", "tab"] as const)("%s部分连音命令原子失败，完整组未经确认不能提交，确认后可保存重载", layer => {
    const { document, target, measure } = fixture();
    const ids = ["tuple-a", "tuple-b", "tuple-c"];
    if (layer === "numbered") {
      measure.numberedVoice.events = ids.map((id, i) => event(id, i * Q * 2 / 3));
      measure.numberedVoice.tuplets = [{ id: "tuple-group", eventIds: ids, ratio: { actual: 3, normal: 2 } }];
    } else {
      measure.beats = [...ids.map((id, i) => beat(id, i * Q * 2 / 3, rhythm(), [i + 1])), beat("tail", Q * 2, rhythm("half"))];
      measure.tuplets = [{ id: "tuple-group", beatIds: ids, ratio: { actual: 3, normal: 2 } }];
    }
    expect(validateDocumentSemantics(document)).toEqual({ ok: true });
    const snapshot = structuredClone(document);
    const partial = { ...target, layer, startTick: Q, endTick: Q, focusTick: Q };
    expect(applyScoreCommand(document, { type: C.ApplyRhythmPattern, target: partial, templateId: "eight-sixteen",
      expectedConfirmationKey: "unused", allowRemoveMarks: true })).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_PARTIAL_TUPLET" });
    expect(document).toEqual(snapshot);
    const full = { ...target, layer, endTick: Q * 2 };
    const p = plan(document, full);
    const command = { type: C.ApplyRhythmPattern, target: full, templateId: p.template.id, expectedConfirmationKey: p.confirmationKey } as const;
    expect(applyScoreCommand(document, command)).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CONFIRMATION_REQUIRED", removedMarkIds: ["tuple-group"] });
    expect(document).toEqual(snapshot);
    const result = commit(document, full, p.template.id, true);
    const next = result.document.score.tracks[0]!.measures[0]!;
    expect(layer === "numbered" ? next.numberedVoice.tuplets : next.tuplets).toEqual([]);
    const contents = layer === "numbered" ? next.numberedVoice.events : next.beats;
    expect(contents.filter(e => ids.includes(e.id)).map(e => e.id)).toEqual(ids);
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    expect(loadDocument(JSON.stringify(result.document))).toMatchObject({ ok: true, document: result.document });
  });

  it("TAB纯延音不能经短模板绕过固定单位拍约束", () => {
    const { document, target, measure } = fixture();
    measure.beats[0] = beat("continuation", 0, rhythm(), ["-", "-"]);
    const t = { ...target, layer: "tab" as const };
    const snapshot = structuredClone(document);
    // setRhythm 已拒绝改短纯延音，模板入口也必须遵守相同领域规则。
    const p = planRhythmPattern(document, t, "eight-sixteen");
    const result = applyScoreCommand(document, { type: C.ApplyRhythmPattern, target: t, templateId: "eight-sixteen",
      expectedConfirmationKey: p.ok ? p.confirmationKey : "unused" });
    expect(p).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_FIXED_CONTINUATION" });
    expect(result).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_FIXED_CONTINUATION" });
    expect(document).toEqual(snapshot);
    expect(commit(document, t, "quarter")).toMatchObject({ changed: false, document });
  });

  it("6/8纯延音仍占八分单位拍，三八模板可保留，分配四分时拒绝", () => {
    const { document, target, measure } = fixture();
    measure.timeSignature = { numerator: 6, denominator: 8 };
    measure.numberedVoice.events = [];
    measure.beats = [beat("continuation", 0, rhythm("eighth"), ["-"]), beat("gap", Q / 2, rhythm("quarter")),
      beat("tail", Q * 1.5, rhythm("quarter", 1))];
    const t = { ...target, layer: "tab" as const };
    const result = commit(document, t, "three-eighths");
    expect(result.document.score.tracks[0]!.measures[0]!.beats[0]).toEqual(measure.beats[0]);
    const before = result.document;
    expect(planRhythmPattern(before, t, "quarter-eight")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_FIXED_CONTINUATION" });
    expect(applyScoreCommand(before, { type: C.ApplyRhythmPattern, target: t, templateId: "quarter-eight",
      expectedConfirmationKey: "unused" })).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_FIXED_CONTINUATION" });
    expect(commit(before, t, "three-eighths").document).toBe(before);
  });

  it("含普通品位和横线的混合TAB拍仍可缩短，保留逐弦实体", () => {
    const { document, target, measure } = fixture();
    measure.beats[0] = beat("mixed", 0, rhythm(), [3, "-"]);
    const result = commit(document, { ...target, layer: "tab" });
    expect(result.document.score.tracks[0]!.measures[0]!.beats[0]).toMatchObject({ id: "mixed", rhythm: rhythm("eighth"), notes: measure.beats[0].notes });
  });

  it.each(["numbered", "tab"] as const)("%s反向原始ticks不提交，规范范围保留反向focus并实际提交", layer => {
    const { document, target } = fixture();
    const reversed = { ...target, layer, startTick: Q * 2, endTick: 0, focusTick: 0 };
    expect(applyScoreCommand(document, { type: C.ApplyRhythmPattern, target: reversed, templateId: "eighths",
      expectedConfirmationKey: "unused" })).toMatchObject({ ok: false, code: "INVALID_RHYTHM_PATTERN_TARGET" });
    const normalized = { ...reversed, startTick: 0, endTick: Q * 2 };
    const result = commit(document, normalized, "eighths");
    expect(layer === "numbered" ? result.nextNumberedFocus : result.nextFocus).toMatchObject(
      layer === "numbered" ? { eventId: "e0" } : { beatId: "b0" });
  });

  for (const signature of [{ numerator: 4, denominator: 4 }, { numerator: 3, denominator: 4 }, { numerator: 6, denominator: 8 }]) {
    for (const layer of ["numbered", "tab"] as const) {
      it.each([1, 2])(`${signature.numerator}/${signature.denominator} ${layer}固定seed=%s连续三轮遍历模板并保存，内容、语义和另一层保持`, seed => {
        const { document, target, measure, track } = fixture();
        measure.timeSignature = signature;
        const count = signature.denominator === 8 ? 2 : signature.numerator;
        const beatTicks = signature.denominator === 8 ? Q * 1.5 : Q;
        const r = rhythm("quarter", signature.denominator === 8 ? 1 : 0);
        measure.numberedVoice.events = Array.from({ length: count }, (_, i) => event(`content-${i}`, i * beatTicks, r,
          i === 1 ? "gap" : (["notes", "gap", "rest", "continuation"] as const)[(i + seed) % 4]!, [String(seed + 1)]));
        measure.beats = Array.from({ length: count }, (_, i) => i === 1 ? beat(`tab-${i}`, i * beatTicks, r)
          : i === seed ? { ...beat(`tab-${i}`, i * beatTicks, r), kind: "rest" } : beat(`tab-${i}`, i * beatTicks, r, [seed, i]));
        measure.lyrics = ([1, 2, 3, 4] as const).map(verse => ({ id: `verse-${verse}`, eventId: "content-1", verse, text: `词${verse}` }));
        measure.chordSymbols = [{ id: "anchored-chord", beatId: "tab-1", display: "name", chord: { name: "C", diagram: null } }];
        expect(validateDocumentSemantics(document)).toEqual({ ok: true });
        const original = structuredClone(measure);
        const t = { ...target, layer, endTick: count * beatTicks };
        let current = document;
        // 固定两种内容种子，轮换模板顺序；不依赖随机数或复制planner算法。
        const templates = getRhythmPatternTemplates(signature);
        for (let round = 0; round < 3; round++) {
          const order = round % 2 ? [...templates].reverse() : [...templates.slice(seed), ...templates.slice(0, seed)];
          for (const template of order) {
            const before = current;
            const result = commit(before, t, template.id);
            expect(result.document.documentRevision).toBe(before.documentRevision + (result.changed ? 1 : 0));
            const next = result.document.score.tracks[0]!.measures[0]!;
            expect(next.lyrics).toEqual(original.lyrics);
            expect(next.chordSymbols).toEqual(original.chordSymbols);
            if (layer === "numbered") {
              expect(next.beats).toEqual(original.beats);
              expect(next.numberedVoice.events.filter(e => e.kind !== "gap" || e.id === "content-1")
                .map(({ id, kind, items }) => ({ id, kind, items }))).toEqual(original.numberedVoice.events
                  .filter(e => e.kind !== "gap" || e.id === "content-1").map(({ id, kind, items }) => ({ id, kind, items })));
            } else {
              expect(next.numberedVoice).toEqual(original.numberedVoice);
              expect(next.beats.filter(b => b.notes.length || b.kind === "rest" || b.id === "tab-1")
                .map(({ id, kind, notes }) => ({ id, kind, notes }))).toEqual(original.beats.map(({ id, kind, notes }) => ({ id, kind, notes })));
            }
            const loaded = loadDocument(JSON.stringify(result.document));
            if (!loaded.ok) throw new Error(loaded.errors.join("、"));
            expect(LXMDocumentSchema.safeParse(loaded.document).success).toBe(true);
            expect(validateDocumentSemantics(loaded.document)).toEqual({ ok: true });
            expect(loaded.document.score.tracks[0]!.techniques).toEqual(track.techniques);
            expect(loaded.document.score.tracks[0]!.numberedMarks).toEqual(track.numberedMarks);
            current = loaded.document;
            expect(commit(current, t, template.id)).toMatchObject({ changed: false, document: current });
          }
        }
      });
    }
  }
});
