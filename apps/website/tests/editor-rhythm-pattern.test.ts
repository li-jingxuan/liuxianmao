import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  getRhythmPatternTemplates,
  loadDocument,
  LXMDocumentSchema,
  LXMScoreCommandEnum as C,
  planRhythmPattern,
  TICKS_PER_QUARTER as Q,
  validateDocumentSemantics,
  type ILXMDocument,
  type ILXMNumberedEvent,
  type ILXMTabCellSelection,
  type MusicTextRange,
  type RhythmPatternTarget,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../components/EditorShell/music-text/music-text-draft";
import { resolveEditorRhythmPatternTarget } from "../components/EditorShell/tools/editor-rhythm-pattern-target";
import { rhythmPatternScopeRect, rhythmPatternScopeRects } from "../components/EditorShell/tools/rhythm-pattern-scope-layout";
import { createEditorSession } from "../stores/editor-store";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  document.score.tracks = [track];
  track.measures = [measure];
  track.techniques = [];
  track.numberedMarks = [];
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.tuplets = [];
  measure.numberedVoice = { tuplets: [], events: Array.from({ length: 4 }, (_, i): ILXMNumberedEvent => ({
    id: `pattern-e${i}`, tick: i * Q, kind: "notes", rhythm: { base: "quarter", dots: 0 },
    items: [{ id: `pattern-i${i}`, token: "1" }],
  })) };
  measure.beats = Array.from({ length: 4 }, (_, i) => ({
    id: `pattern-b${i}`, tick: i * Q, kind: "notes" as const, rhythm: { base: "quarter" as const, dots: 0 },
    notes: [{ id: `pattern-n${i}`, string: 1, fret: 3 }],
  }));
  measure.chordSymbols = [{ id: "pattern-chord", beatId: "pattern-b0", display: "name", chord: { name: "C", diagram: null } }];
  measure.lyrics = ([1, 2, 3, 4] as const).map(verse => ({ id: `pattern-lyric${verse}`, eventId: "pattern-e0", verse, text: `风${verse}` }));
  const range: MusicTextRange = { kind: "numbered", trackId: track.id,
    anchor: { measureId: measure.id, eventId: "pattern-e0" }, focus: { measureId: measure.id, eventId: "pattern-e1" } };
  const active: MusicTextTarget = { kind: "numbered", trackId: track.id, measureId: measure.id, eventId: "pattern-e0" };
  const cell = { trackId: track.id, measureId: measure.id, beatId: "pattern-b0", string: 1 };
  const selection: ILXMTabCellSelection = { anchor: cell, focus: cell };
  return { document, track, measure, range, active, selection };
};
const resolve = (...args: Parameters<typeof resolveEditorRhythmPatternTarget>) => {
  const result = resolveEditorRhythmPatternTarget(...args);
  if (!result.ok) throw new Error(result.message);
  return result.target;
};
const preview = (document: ILXMDocument, target: RhythmPatternTarget, templateId = "eight-sixteen") => {
  const result = planRhythmPattern(document, target, templateId);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
};

const appendFixtureMeasure = (track: ReturnType<typeof fixture>["track"], id: string) => {
  const measure = structuredClone(track.measures[0]!);
  measure.id = id;
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.beats.forEach(beat => {
    beat.id += `-${id}`;
    beat.notes.forEach(note => { note.id += `-${id}`; });
  });
  measure.numberedVoice.events.forEach(event => {
    event.id += `-${id}`;
    event.items.forEach(item => { item.id += `-${id}`; });
  });
  track.measures.push(measure);
  return measure;
};

describe("节奏型当前谱层目标解析", () => {
  it("单点长简谱事件始终返回零长度，不能误当连续多拍；跨scope保护提示扩大", () => {
    const { document, measure, active, selection } = fixture();
    measure.numberedVoice.events.splice(0, 2, { ...measure.numberedVoice.events[0]!, rhythm: { base: "half", dots: 0 } });
    const target = resolve(document, selection, null, active);
    expect(target).toMatchObject({ layer: "numbered", startTick: 0, endTick: 0, focusTick: 0 });
    expect(planRhythmPattern(document, target, "eight-sixteen")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CROSSING_CONTENT", message: expect.stringContaining("扩大选区") });
    const singleton: MusicTextRange = { kind: "numbered", trackId: active.trackId,
      anchor: { measureId: measure.id, eventId: "pattern-e0" }, focus: { measureId: measure.id, eventId: "pattern-e0" } };
    expect(resolve(document, null, singleton, null)).toEqual(target);
  });

  it("numbered continuousRange独立于store的两种selection，正反向保留真正focus", () => {
    const { document, range } = fixture();
    const session = createEditorSession(document);
    expect(session.getState().selection).toBeNull();
    expect(session.getState().numberedSelection).toBeNull();
    const forward = resolve(session.getState().document!, null, range, null);
    const reverse = resolve(document, null, { ...range, anchor: range.focus, focus: range.anchor }, null);
    expect(forward).toMatchObject({ layer: "numbered", startTick: 0, endTick: Q * 2, focusTick: Q });
    expect(reverse).toEqual({ ...forward, focusTick: 0 });
    expect(preview(document, reverse).scope).toMatchObject({ firstBeat: 1, lastBeat: 2, beatCount: 2 });
  });

  it("反向不足一拍范围按focus归拍，连续范围保留末事件完整实际时长", () => {
    const { document, range, measure } = fixture();
    measure.numberedVoice.events = [
      { ...measure.numberedVoice.events[0]!, tick: Q * 3 / 4, rhythm: { base: "sixteenth", dots: 0 } },
      { ...measure.numberedVoice.events[1]!, tick: Q, rhythm: { base: "sixteenth", dots: 0 } },
    ];
    const t = resolve(document, null, { ...range, anchor: range.focus, focus: range.anchor }, null);
    expect(t).toMatchObject({ startTick: Q * 3 / 4, endTick: Q * 5 / 4, focusTick: Q * 3 / 4 });
    expect(preview(document, t).scope).toMatchObject({ startTick: 0, endTick: Q });
    const forward = resolve(document, null, range, null);
    expect(preview(document, forward).scope).toMatchObject({ startTick: Q, endTick: Q * 2 });
  });

  it("TAB同一长beat多弦仍为单点；多个beat连续选区保留focus及末beat时长", () => {
    const { document, selection, measure } = fixture();
    measure.beats.splice(0, 2, { ...measure.beats[0]!, rhythm: { base: "half", dots: 0 } });
    const six = { ...selection, focus: { ...selection.focus, string: 6 } };
    const single = resolve(document, six, null, null);
    expect(single).toMatchObject({ layer: "tab", startTick: 0, endTick: 0, focusTick: 0 });
    expect(planRhythmPattern(document, single, "eight-sixteen")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CROSSING_CONTENT" });
    const forward = { ...six, focus: { ...six.focus, beatId: "pattern-b2" } };
    expect(resolve(document, forward, null, null)).toMatchObject({ startTick: 0, endTick: Q * 3, focusTick: Q * 2 });
    expect(resolve(document, { anchor: forward.focus, focus: forward.anchor }, null, null)).toMatchObject({ startTick: 0, endTick: Q * 3, focusTick: 0 });
  });

  it("活动歌词/和弦不回退残留TAB或简谱范围；活动简谱优先于残留TAB", () => {
    const { document, active, selection, range } = fixture();
    const lyric: MusicTextTarget = { kind: "lyric", trackId: active.trackId, measureId: active.measureId, eventId: "pattern-e0", verse: 1 };
    const chord: MusicTextTarget = { ...selection.focus, kind: "chord" };
    for (const current of [lyric, chord]) {
      expect(resolveEditorRhythmPatternTarget(document, selection, null, current).ok).toBe(false);
      expect(resolveEditorRhythmPatternTarget(document, selection, range, current).ok).toBe(false);
    }
    expect(resolveEditorRhythmPatternTarget(document, selection, { ...range, kind: "lyric", verse: 1 }, active).ok).toBe(false);
    expect(resolve(document, selection, null, active).layer).toBe("numbered");
    expect(resolveEditorRhythmPatternTarget(document, null, null, null).ok).toBe(false);
  });

  it("跨轨、陈旧event/beat/item/measure ID均阻止，不借用残留目标", () => {
    const { document, active, range, selection } = fixture();
    const crossMeasure = { ...range, focus: { ...range.focus, measureId: "another-measure" } };
    expect(resolveEditorRhythmPatternTarget(document, selection, crossMeasure, active).ok).toBe(false);
    expect(resolveEditorRhythmPatternTarget(document, { ...selection, focus: { ...selection.focus, measureId: "another-measure" } }, null, null).ok).toBe(false);
    expect(resolveEditorRhythmPatternTarget(document, { ...selection, focus: { ...selection.focus, trackId: "another-track" } }, null, null).ok).toBe(false);
    expect(resolveEditorRhythmPatternTarget(document, selection, { ...range, trackId: "another-track" }, null).ok).toBe(false);
    for (const stale of [{ ...active, eventId: "missing-event" }, { ...active, itemId: "missing-item" }, { ...active, measureId: "missing-measure" }, { ...active, trackId: "missing-track" }])
      expect(resolveEditorRhythmPatternTarget(document, selection, null, stale).ok).toBe(false);
    expect(resolveEditorRhythmPatternTarget(document, null, { ...range, focus: { ...range.focus, eventId: "missing-event" } }, null).ok).toBe(false);
    expect(resolveEditorRhythmPatternTarget(document, { ...selection, focus: { ...selection.focus, beatId: "missing-beat" } }, null, null).ok).toBe(false);
  });
});

describe("跨小节节奏型", () => {
  it.each(["numbered", "tab"] as const)("%s 反向跨谱行选区按小节预览，一次提交和撤销", (layer) => {
    const { document, track, measure, range, selection } = fixture();
    appendFixtureMeasure(track, "middle");
    const last = appendFixtureMeasure(track, "last");
    const numberedRange = { ...range, anchor: { measureId: last.id, eventId: "pattern-e0-last" },
      focus: { measureId: measure.id, eventId: "pattern-e3" } };
    const tabRange = { anchor: { ...selection.anchor, measureId: last.id, beatId: "pattern-b0-last" },
      focus: { ...selection.focus, beatId: "pattern-b3" } };
    const target = layer === "numbered" ? resolve(document, null, numberedRange, null) : resolve(document, tabRange, null, null);
    expect(target).toMatchObject({ measureId: measure.id, endMeasureId: last.id, focusMeasureId: measure.id, startTick: Q * 3, endTick: Q });
    const session = createEditorSession(document);
    const before = session.getState().document!;
    const plan = preview(before, target, "eighths");
    expect(plan.scopes.map(scope => [scope.measureId, scope.firstBeat, scope.lastBeat])).toEqual([
      [measure.id, 4, 4], ["middle", 1, 4], [last.id, 1, 1],
    ]);
    const rectangles = rhythmPatternScopeRects(buildLayout(before, { purpose: "editing", systemWidth: 180 }), plan.target);
    expect(rectangles.map(rect => rect.measureId)).toEqual([measure.id, "middle", last.id]);
    expect(rectangles[0]!.y).toBeLessThan(rectangles[2]!.y);
    expect(plan.focus.measureId).toBe(measure.id);
    expect(planRhythmPattern(before, target, "measure-44-eighths")).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_TEMPLATE_MISMATCH" });
    const command = { type: C.ApplyRhythmPattern, target, templateId: plan.template.id, expectedConfirmationKey: plan.confirmationKey } as const;
    const result = session.getState().execute(command);
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = session.getState().document!;
    const counts = after.score.tracks[0]!.measures.map(item => layer === "numbered" ? item.numberedVoice.events.length : item.beats.length);
    expect(counts).toEqual([5, 8, 5]);
    expect(new Set(plan.after.map(event => event.id)).size).toBe(plan.after.length);
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
  });

  it("跨小节连接根据合并后的轨道判断，混合拍号或末段阻断时保持原文档", () => {
    const { document, track, measure } = fixture();
    const last = appendFixtureMeasure(track, "last");
    track.numberedMarks = [{ id: "cross-tie", type: "tie", fromItemId: "pattern-i3", toItemId: "pattern-i0-last" }];
    const target: RhythmPatternTarget = { layer: "numbered", trackId: track.id, measureId: measure.id,
      endMeasureId: last.id, focusMeasureId: last.id, startTick: 0, endTick: Q * 4, focusTick: 0 };
    const whole = preview(document, target, "measure-44-eighths");
    expect(whole.removedMarks).toEqual([{ id: "cross-tie", name: "延音线", type: "tie", crossesScope: false }]);
    expect(whole.focus.measureId).toBe(last.id);
    last.timeSignature = { numerator: 3, denominator: 4 };
    last.numberedVoice.events.pop();
    last.beats.pop();
    expect(preview(document, { ...target, endTick: Q * 3 }, "eighths").scopes).toHaveLength(2);
    last.timeSignature = { numerator: 6, denominator: 8 };
    expect(planRhythmPattern(document, { ...target, endTick: Q * 3 }, "eighths")).toMatchObject({
      ok: false, message: expect.stringContaining("第 2 小节（6/8）"),
    });
    last.timeSignature = { numerator: 3, denominator: 4 };
    last.numberedVoice.events.splice(0, 2, { ...last.numberedVoice.events[0]!, rhythm: { base: "half", dots: 0 } });
    const session = createEditorSession(document);
    const before = session.getState().document!;
    const failing = { ...target, endTick: Q };
    expect(session.getState().execute({ type: C.ApplyRhythmPattern, target: failing, templateId: "eighths", expectedConfirmationKey: "" })).toMatchObject({
      ok: false, code: "RHYTHM_PATTERN_CROSSING_CONTENT", message: expect.stringContaining("第 2 小节"),
    });
    expect(session.getState().document).toBe(before);
    expect(session.getState().historyDepth.past).toBe(0);
  });
});

describe("节奏型归齐范围的谱面高亮", () => {
  it("buildLayout的真实时间锚点生成同一范围的独立简谱/TAB矩形", () => {
    const { document, range } = fixture();
    const target = preview(document, resolve(document, null, range, null)).target;
    const layout = buildLayout(document, { purpose: "editing", systemWidth: 1000 });
    const numbered = rhythmPatternScopeRect(layout, target)!;
    const tab = rhythmPatternScopeRect(layout, { ...target, layer: "tab" })!;
    expect(numbered).not.toBeNull();
    expect(tab).not.toBeNull();
    expect(numbered.x).toBe(tab.x);
    expect(numbered.width).toBe(tab.width);
    expect(numbered.width).toBeGreaterThan(24);
    expect(numbered.y + numbered.height < tab.y || tab.y + tab.height < numbered.y).toBe(true);
    const row = layout.systems.find(s => s.measures.some(m => m.id === target.measureId))!.numberedRow!;
    expect(numbered).toMatchObject({ y: row.y - 4, height: row.height + 8 });
    expect(rhythmPatternScopeRect(layout, { ...target, trackId: "other" })).toBeNull();
    expect(rhythmPatternScopeRect(layout, { ...target, measureId: "missing" })).toBeNull();
    expect(rhythmPatternScopeRect(layout, { ...target, endTick: target.startTick })).toBeNull();
  });
});

describe("节奏型真实EditorSession原子历史", () => {
  it.each(["numbered", "tab"] as const)("%s两拍同时保留合法技巧和移除失效连接，undo/redo恢复完整文档", layer => {
    const { document, range, track, selection } = fixture();
    track.numberedMarks = [{ id: "pattern-tie", type: "tie", fromItemId: "pattern-i0", toItemId: "pattern-i1" }, { id: "pattern-fermata", type: "fermata", eventId: "pattern-e0" }, { id: "pattern-outside", type: "fermata", eventId: "pattern-e3" }];
    track.techniques = [{ id: "pattern-tab-tie", type: "tie", fromNoteId: "pattern-n0", toNoteId: "pattern-n1" }, { id: "pattern-vibrato", type: "vibrato", fromNoteId: "pattern-n0" }];
    const session = createEditorSession(document);
    const before = structuredClone(session.getState().document!);
    const tabRange = { ...selection, focus: { ...selection.focus, beatId: "pattern-b1", string: 6 } };
    const target = layer === "numbered" ? resolve(document, null, range, null) : resolve(document, tabRange, null, null);
    const p = preview(session.getState().document!, target);
    const command = { type: C.ApplyRhythmPattern, target, templateId: "eight-sixteen", expectedConfirmationKey: p.confirmationKey } as const;
    expect(session.getState().execute(command)).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_CONFIRMATION_REQUIRED" });
    expect(session.getState().document).toEqual(before);
    expect(session.getState().historyDepth).toEqual({ past: 0, future: 0 });
    expect(session.getState().execute({ ...command, allowRemoveMarks: true })).toMatchObject({ ok: true, changed: true });
    const after = structuredClone(session.getState().document!);
    expect(after.documentRevision).toBe(before.documentRevision + 1);
    expect(session.getState().historyDepth).toEqual({ past: 1, future: 0 });
    const nextTrack = after.score.tracks[0]!;
    expect(nextTrack.measures[0]!.lyrics).toEqual(before.score.tracks[0]!.measures[0]!.lyrics);
    expect(nextTrack.measures[0]!.chordSymbols).toEqual(before.score.tracks[0]!.measures[0]!.chordSymbols);
    if (layer === "numbered") {
      expect(nextTrack.techniques).toEqual(track.techniques);
      expect(nextTrack.measures[0]!.beats).toEqual(before.score.tracks[0]!.measures[0]!.beats);
      expect(nextTrack.numberedMarks.map(m => m.id)).toEqual(["pattern-fermata", "pattern-outside"]);
    } else {
      expect(nextTrack.numberedMarks).toEqual(track.numberedMarks);
      expect(nextTrack.measures[0]!.numberedVoice).toEqual(before.score.tracks[0]!.measures[0]!.numberedVoice);
      expect(nextTrack.techniques.map(m => m.id)).toEqual(["pattern-vibrato"]);
    }
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
    expect(session.getState().historyDepth).toEqual({ past: 0, future: 1 });
    session.getState().redo();
    expect(session.getState().document).toEqual(after);
    expect(session.getState().historyDepth).toEqual({ past: 1, future: 0 });
  });

  it("无标记模板直接提交，重复应用noop不加历史、不更换document引用", () => {
    const { document, range } = fixture();
    const session = createEditorSession(document);
    const target = resolve(document, null, range, null);
    const p = preview(session.getState().document!, target);
    expect(p.removedMarks).toEqual([]);
    expect(session.getState().execute({ type: C.ApplyRhythmPattern, target, templateId: p.template.id, expectedConfirmationKey: p.confirmationKey })).toMatchObject({ ok: true, changed: true });
    const after = session.getState().document!;
    const next = preview(after, target);
    expect(session.getState().execute({ type: C.ApplyRhythmPattern, target, templateId: next.template.id, expectedConfirmationKey: next.confirmationKey })).toMatchObject({ ok: true, changed: false });
    expect(session.getState().document).toBe(after);
    expect(session.getState().historyDepth).toEqual({ past: 1, future: 0 });
  });

  it("旧预览key、变更目标、变更模板及相同revision不同内容均失败且不写文档历史", () => {
    const { document, range } = fixture();
    const target = resolve(document, null, range, null);
    const session = createEditorSession(document);
    const p = preview(session.getState().document!, target);
    const command = { type: C.ApplyRhythmPattern, target, templateId: p.template.id, expectedConfirmationKey: p.confirmationKey, allowRemoveMarks: true } as const;
    for (const stale of [{ ...command, expectedConfirmationKey: "expired" }, { ...command, target: { ...target, focusTick: 0 } }, { ...command, templateId: "eighths" }]) {
      expect(session.getState().execute(stale)).toMatchObject({ ok: false, code: "STALE_RHYTHM_PATTERN_PLAN" });
      expect(session.getState().document).toEqual(document);
      expect(session.getState().historyDepth).toEqual({ past: 0, future: 0 });
    }
    const changed = structuredClone(document);
    changed.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!.items[0]!.token = "5";
    const sameRevision = createEditorSession(changed);
    expect(sameRevision.getState().execute(command)).toMatchObject({ ok: false, code: "STALE_RHYTHM_PATTERN_PLAN" });
    expect(sameRevision.getState().document).toEqual(changed);
    expect(sameRevision.getState().historyDepth).toEqual({ past: 0, future: 0 });
    expect(session.getState().execute({ ...command, expectedConfirmationKey: p.confirmationKey })).toMatchObject({ ok: true, changed: true });
    const applied = session.getState().document!;
    expect(session.getState().execute(command)).toMatchObject({ ok: false, code: "STALE_RHYTHM_PATTERN_PLAN" });
    expect(session.getState().document).toBe(applied);
    expect(session.getState().historyDepth).toEqual({ past: 1, future: 0 });
  });

  it("模板库随实际小节拍号提供12/9项，6/8自然细分没有连音或确认标记", () => {
    const { document, measure, active } = fixture();
    expect(getRhythmPatternTemplates(measure.timeSignature)).toHaveLength(12);
    measure.timeSignature = { numerator: 3, denominator: 4 };
    expect(getRhythmPatternTemplates(measure.timeSignature)).toHaveLength(12);
    measure.timeSignature = { numerator: 6, denominator: 8 };
    measure.numberedVoice.events = [];
    measure.lyrics = [];
    measure.chordSymbols = [];
    measure.beats = [0, Q * 1.5].map((tick, i) => ({ id: `compound-b${i}`, tick, kind: "notes", notes: [], rhythm: { base: "quarter", dots: 1 } }));
    expect(getRhythmPatternTemplates(measure.timeSignature)).toHaveLength(9);
    const target = resolve(document, null, null, { ...active, eventId: undefined, tick: 0, endTick: Q * 1.5 });
    const session = createEditorSession(document);
    const p = preview(session.getState().document!, target, "three-eighths");
    expect(p.scope).toMatchObject({ beatTicks: Q * 1.5, beatCount: 1 });
    expect(p.after.map(e => e.tick)).toEqual([0, Q / 2, Q]);
    expect(p.removedMarks).toEqual([]);
    expect(p.track.measures[0]!.numberedVoice.tuplets).toEqual([]);
    expect(session.getState().execute({ type: C.ApplyRhythmPattern, target, templateId: "three-eighths", expectedConfirmationKey: p.confirmationKey })).toMatchObject({ ok: true, changed: true });
    expect(session.getState().historyDepth.past).toBe(1);
  });
});

describe("整小节节奏型提交与撤销", () => {
  it.each(["numbered", "tab"] as const)("%s 逐拍统计超额，确认后一次应用与撤销", (layer) => {
    const { document, measure, active, selection } = fixture();
    const eighth = { base: "eighth", dots: 0 } as const;
    measure.numberedVoice.events[0]!.rhythm = eighth;
    measure.numberedVoice.events.splice(1, 0, { id: "extra-event", tick: Q / 2, rhythm: eighth, kind: "notes", items: [{ id: "extra-item", token: "2" }] });
    measure.lyrics.push({ id: "extra-lyric", eventId: "extra-event", verse: 1, text: "雨" });
    measure.beats[0]!.rhythm = eighth;
    measure.beats.splice(1, 0, { id: "extra-beat", tick: Q / 2, rhythm: eighth, kind: "notes", notes: [{ id: "extra-note", string: 1, fret: 5 }] });
    measure.chordSymbols.push({ id: "extra-chord", beatId: "extra-beat", display: "name", chord: { name: "G", diagram: null } });
    const secondBeat = { ...selection.focus, beatId: "pattern-b1" };
    const target = layer === "numbered" ? resolve(document, null, null, { ...active, eventId: "pattern-e1" })
      : resolve(document, { anchor: secondBeat, focus: secondBeat }, null, null);
    const session = createEditorSession(document);
    const before = session.getState().document!;
    const p = preview(before, target, "measure-44-quarter-split");
    expect(p.perBeat.map(({ retainedCount, gapCount, discardedCount }) => [retainedCount, gapCount, discardedCount]))
      .toEqual([[1, 0, 1], [1, 2, 0], [1, 0, 0], [1, 2, 0]]);
    expect(p.focus).toMatchObject({ tick: Q, endTick: Q * 1.5 });
    expect(p.discardedTextCount).toBe(1);
    const command = { type: C.ApplyRhythmPattern, target, templateId: p.template.id, expectedConfirmationKey: p.confirmationKey } as const;
    expect(session.getState().execute(command)).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_TEXT_CONFIRMATION_REQUIRED" });
    expect(session.getState().historyDepth.past).toBe(0);
    expect(session.getState().execute({ ...command, allowDiscardMusicText: true })).toMatchObject({ ok: true, changed: true });
    const after = session.getState().document!;
    expect(validateDocumentSemantics(after)).toEqual({ ok: true });
    const updated = after.score.tracks[0]!.measures[0]!;
    expect(updated.lyrics.some(({ id }) => id === "extra-lyric")).toBe(layer === "tab");
    expect(updated.chordSymbols.some(({ id }) => id === "extra-chord")).toBe(layer === "numbered");
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
  });
});

describe("节奏型反向选择与持久化回归", () => {
  it.each(["numbered", "tab"] as const)("%s反向范围经解析后真实提交，focus保持起端且undo/redo恢复完整文档", layer => {
    const { document, range, selection } = fixture();
    const reverse = { ...range, anchor: range.focus, focus: range.anchor };
    const tabReverse = { anchor: { ...selection.anchor, beatId: "pattern-b1", string: 6 }, focus: selection.focus };
    const target = layer === "numbered" ? resolve(document, null, reverse, null) : resolve(document, tabReverse, null, null);
    expect(target).toMatchObject({ layer, startTick: 0, endTick: Q * 2, focusTick: 0 });
    const session = createEditorSession(document);
    const p = preview(session.getState().document!, target);
    expect(session.getState().execute({ type: C.ApplyRhythmPattern, target, templateId: p.template.id,
      expectedConfirmationKey: p.confirmationKey })).toMatchObject({ ok: true, changed: true });
    const after = session.getState().document!;
    expect(layer === "numbered" ? session.getState().numberedSelection : session.getState().selection?.focus)
      .toMatchObject(layer === "numbered" ? { eventId: "pattern-e0" } : { beatId: "pattern-b0" });
    expect(validateDocumentSemantics(after)).toEqual({ ok: true });
    expect(session.getState().historyDepth).toEqual({ past: 1, future: 0 });
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
    session.getState().redo();
    expect(session.getState().document).toEqual(after);
  });

  it.each(["numbered", "tab"] as const)("%s两端在范围外且仍合法的连接保留，可直接应用和撤销", layer => {
    const { document, track, measure, active, selection } = fixture();
    measure.beats[1]!.notes = [];
    measure.beats[2]!.notes = [];
    measure.beats[3]!.notes[0]!.fret = 5;
    track.numberedMarks = [{ id: "outside-slur", type: "slur", fromEventId: "pattern-e0", toEventId: "pattern-e3" }];
    track.techniques = [{ id: "outside-slide", type: "slideUp", fromNoteId: "pattern-n0", toNoteId: "pattern-n3" }];
    const target = layer === "numbered" ? resolve(document, null, null, { ...active, eventId: "pattern-e1" })
      : resolve(document, { anchor: { ...selection.anchor, beatId: "pattern-b1" }, focus: { ...selection.focus, beatId: "pattern-b1" } }, null, null);
    expect(validateDocumentSemantics(document)).toEqual({ ok: true });
    const session = createEditorSession(document);
    const p = preview(session.getState().document!, target);
    expect(p.removedMarks).toEqual([]);
    const command = { type: C.ApplyRhythmPattern, target, templateId: p.template.id, expectedConfirmationKey: p.confirmationKey } as const;
    expect(session.getState().execute(command)).toMatchObject({ ok: true, changed: true });
    const next = session.getState().document!.score.tracks[0]!;
    expect(layer === "numbered" ? next.numberedMarks : next.techniques).toEqual(layer === "numbered" ? track.numberedMarks : track.techniques);
    expect(layer === "numbered" ? next.techniques : next.numberedMarks).toEqual(layer === "numbered" ? track.techniques : track.numberedMarks);
    expect(session.getState().historyDepth).toEqual({ past: 1, future: 0 });
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
  });

  it("纯TAB延音应用短模板失败，不替换文档、不留历史或失效focus", () => {
    const { document, measure, selection } = fixture();
    measure.beats[0]!.notes = [{ id: "pure-continuation", string: 3, fret: "-" }];
    const target = resolve(document, selection, null, null);
    const session = createEditorSession(document);
    session.getState().setSelection(selection);
    const before = session.getState().document;
    expect(session.getState().execute({ type: C.ApplyRhythmPattern, target, templateId: "eight-sixteen",
      expectedConfirmationKey: "unused" })).toMatchObject({ ok: false, code: "RHYTHM_PATTERN_FIXED_CONTINUATION" });
    expect(session.getState().document).toBe(before);
    expect(session.getState().selection).toEqual(selection);
    expect(session.getState().historyDepth).toEqual({ past: 0, future: 0 });
  });

  it.each(["numbered", "tab"] as const)("%s连续三轮模板切换、noop和重载，历史仅记录变化且另一谱层不受影响", layer => {
    const { document, range, selection } = fixture();
    const target = layer === "numbered" ? resolve(document, null, range, null)
      : resolve(document, { ...selection, focus: { ...selection.focus, beatId: "pattern-b1", string: 6 } }, null, null);
    const original = structuredClone(document.score.tracks[0]!.measures[0]!);
    let session = createEditorSession(document);
    for (let round = 0; round < 3; round++) {
      // 包括最长细分和单槽收缩；每拍仅一个内容，所有模板都应允许实际提交。
      for (const template of getRhythmPatternTemplates(original.timeSignature)) {
        const before = session.getState().document!;
        const depth = session.getState().historyDepth.past;
        const p = preview(before, target, template.id);
        const command = { type: C.ApplyRhythmPattern, target, templateId: template.id, expectedConfirmationKey: p.confirmationKey } as const;
        expect(session.getState().execute(command)).toMatchObject({ ok: true, changed: p.changed });
        const after = session.getState().document!;
        expect(session.getState().historyDepth).toEqual({ past: depth + (p.changed ? 1 : 0), future: 0 });
        expect(after.documentRevision).toBe(before.documentRevision + (p.changed ? 1 : 0));
        const noop = preview(after, target, template.id);
        expect(session.getState().execute({ ...command, expectedConfirmationKey: noop.confirmationKey })).toMatchObject({ ok: true, changed: false });
        expect(session.getState().document).toBe(after);
        const m = after.score.tracks[0]!.measures[0]!;
        expect(layer === "numbered" ? m.beats : m.numberedVoice).toEqual(layer === "numbered" ? original.beats : original.numberedVoice);
        expect(m.lyrics).toEqual(original.lyrics);
        expect(m.chordSymbols).toEqual(original.chordSymbols);
        expect(m.beats.filter(b => b.tick >= Q * 2)).toEqual(original.beats.slice(2));
        expect(m.numberedVoice.events.filter(e => e.tick >= Q * 2)).toEqual(original.numberedVoice.events.slice(2));
        const loaded = loadDocument(JSON.stringify(after));
        if (!loaded.ok) throw new Error(loaded.errors.join("、"));
        expect(LXMDocumentSchema.safeParse(loaded.document).success).toBe(true);
        expect(validateDocumentSemantics(loaded.document)).toEqual({ ok: true });
        expect(loaded.document).toEqual(after);
        if (p.changed) {
          session.getState().undo();
          expect(session.getState().document).toEqual(before);
          session.getState().redo();
          expect(session.getState().document).toEqual(after);
        }
        // 模拟重新打开保存文档，重载后的第一次相同模板也必须是noop。
        session = createEditorSession(loaded.document);
        const reopened = preview(loaded.document, target, template.id);
        expect(session.getState().execute({ ...command, expectedConfirmationKey: reopened.confirmationKey })).toMatchObject({ ok: true, changed: false });
        expect(session.getState().historyDepth).toEqual({ past: 0, future: 0 });
      }
    }
  });
});
