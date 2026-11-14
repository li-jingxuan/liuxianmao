import { describe, expect, it } from "vitest";
import { applyScoreCommand } from "../../src/core/commands/commands";
import { planNumberedEventRhythm } from "../../src/core/numbered/numbered-timeline";
import { editNumberedTrack } from "../../src/core/numbered/numbered-commands";
import { createDocumentIdFactory } from "../../src/core/id-factory";
import { validateNumberedVoice } from "../../src/core/numbered/numbered-rhythm";
import { planNumberedInputRanges } from "../../src/core/numbered/numbered-input-ranges";
import { buildLayout } from "../../src/layout/index";
import example from "../../example/example-mvp7.2";
import type { ILXMNumberedEvent, ILXMRhythm } from "../../src/core/types";

const note = (tick: number, base: ILXMRhythm["base"] = "sixteenth", dots = 0): ILXMNumberedEvent => ({
  id: `e${tick}`, tick, rhythm: { base, dots }, kind: "notes",
  items: [{ id: `i${tick}`, token: "3" }],
});
const fixture = (events = [0, 240, 480, 720, 960].map(tick => note(tick))) => {
  const document = structuredClone(example);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = [];
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.lyrics = [];
  measure.numberedVoice = { events, tuplets: [] };
  return { document, track, measure };
};

describe("BUG023–025 真实时间窗与简谱连梁", () => {
  it.each([0, 240, 480])("第 %i tick 音加点再取消完整还原四个16分及尾部、歌词、连接记号", tick => {
    const { document, track, measure } = fixture();
    measure.lyrics = measure.numberedVoice.events.map(event => ({ id: `l${event.id}`, eventId: event.id, verse: 1, text: "词" }));
    track.numberedMarks = [
      { id: "slur", type: "slur", fromEventId: "e0", toEventId: "e720" },
      { id: "tie", type: "tie", fromItemId: `i${tick}`, toItemId: `i${tick + 240}` },
    ];
    const command = { type: "numbered.event.setRhythm" as const, trackId: track.id, measureId: measure.id, eventId: `e${tick}`, rhythm: { base: "sixteenth" as const, dots: 1 } };
    const dotted = applyScoreCommand(document, command);
    expect(dotted.ok, JSON.stringify(dotted)).toBe(true);
    if (!dotted.ok) return;
    const after = dotted.document.score.tracks[0]!.measures[0]!;
    expect(after.numberedVoice.events.map(e => e.tick)).toEqual([0, 240, 480, 720, 960].map(t => t === tick + 240 ? t + 120 : t));
    expect(after.numberedVoice.events.find(e => e.id === `e${tick + 240}`)!.rhythm).toEqual({ base: "thirtySecond", dots: 0 });
    expect(after.lyrics).toEqual(measure.lyrics);
    expect(dotted.document.score.tracks[0]!.numberedMarks).toEqual(track.numberedMarks);
    const restored = applyScoreCommand(dotted.document, { ...command, rhythm: { base: "sixteenth", dots: 0 } });
    expect(restored.ok, JSON.stringify(restored)).toBe(true);
    if (!restored.ok) return;
    expect(restored.document.score.tracks[0]).toEqual(track);
    const layout = buildLayout(restored.document);
    const frames = layout.systems[0]!.measures[0]!.numberedNotation!;
    const shared = frames.flatMap(frame => frame.lines!).filter(line => line.shared);
    expect(shared).toHaveLength(2);
    expect(shared[0]!.x2).toBeGreaterThan(frames[3]!.labels[0]!.x);
    expect(shared[1]!.x2).toBeGreaterThan(frames[3]!.labels[0]!.x);
  });

  it("普通base增长吞并部分覆盖的长后音，释放其未覆盖尾部且更后tick固定", () => {
    const { document, track, measure } = fixture([note(0), note(240, "quarter"), note(1440)]);
    measure.lyrics = [{ id: "covered-lyric", eventId: "e240", verse: 1, text: "吞" }];
    track.numberedMarks = [{ id: "covered-mark", type: "fermata", eventId: "e240" }];
    const command = { type: "numbered.event.setRhythm" as const, trackId: track.id, measureId: measure.id, eventId: "e0", rhythm: { base: "eighth" as const, dots: 0 }, timeline: "editTimeline" as const };
    const preview = editNumberedTrack(track, command, createDocumentIdFactory(document), true);
    expect(preview).toMatchObject({ ok: true, overwrittenEventIds: ["e240"], movedEventIds: [], removedMarkIds: ["covered-mark"] });
    const unconfirmed = applyScoreCommand(document, command);
    expect(unconfirmed).toMatchObject({ ok: false, code: "NUMBERED_IMPACT_REQUIRED" });
    const committed = applyScoreCommand(document, { ...command, confirmedRemovedMarkIds: ["covered-mark"], confirmedChangedMarkIds: [] });
    expect(committed.ok, JSON.stringify(committed)).toBe(true);
    if (!committed.ok || !preview.ok) return;
    const result = committed.document.score.tracks[0]!.measures[0]!;
    expect(result.numberedVoice).toEqual(preview.track.measures[0]!.numberedVoice);
    expect(result.numberedVoice.events.map(e => e.tick)).toEqual([0, 1440]);
    expect(result.lyrics).toEqual([]);
    expect(planNumberedInputRanges(result).some(range => range.startTick === 480)).toBe(true);
    expect(buildLayout(committed.document, { purpose: "editing" }).systems[0]!.measures[0]!.numberedInputSlots!.some(slot => slot.startTick === 480)).toBe(true);
  });

  it("减点遇真实gap只释放，不把gap拉长；加点优先消耗空白", () => {
    const gap: ILXMNumberedEvent = { ...note(360, "thirtySecond"), kind: "gap", items: [] };
    const { measure } = fixture([note(0, "sixteenth", 1), gap, note(480)]);
    const result = planNumberedEventRhythm(measure, "e0", { base: "sixteenth", dots: 0 });
    expect(result).toMatchObject({ ok: true, movedEventIds: [], releasedRange: { startTick: 240, endTick: 360 } });
    if (!result.ok) return;
    expect(result.voice.events[1]).toEqual(gap);
    const blank = fixture([note(0), note(480)]).measure;
    expect(planNumberedEventRhythm(blank, "e0", { base: "sixteenth", dots: 1 })).toMatchObject({ ok: true, movedEventIds: [], overwrittenEventIds: [] });
  });

  it("已有附点与32分的互补可编码时调整，跨拍、相邻音不足和不可编码时拒绝", () => {
    const m = fixture([note(240, "sixteenth", 1), note(600, "thirtySecond"), note(720)]).measure;
    expect(planNumberedEventRhythm(m, "e240", { base: "sixteenth", dots: 0 })).toMatchObject({ ok: true, movedEventIds: ["e600"] });
    for (const events of [
      [note(720), note(960)],
      [note(3600)],
      [note(0), note(240, "thirtySecond")],
      [note(0, "thirtySecond"), note(120, "thirtySecond")],
    ]) {
      const measure = fixture(events).measure;
      const before = structuredClone(measure);
      expect(planNumberedEventRhythm(measure, events[0]!.id, { ...events[0]!.rhythm, dots: 1 })).toMatchObject({ ok: false });
      expect(measure).toEqual(before);
    }
  });

  it("附点互补不能调节连音成员", () => {
    const { measure } = fixture([note(0), note(240), note(400), note(560)]);
    measure.numberedVoice.tuplets = [{ id: "triplet", ratio: { actual: 3, normal: 2 }, eventIds: ["e240", "e400", "e560"] }];
    expect(planNumberedEventRhythm(measure, "e0", { base: "sixteenth", dots: 1 })).toMatchObject({ ok: false, code: "EVENT_IN_TUPLET" });
  });

  it.each(["implicit", "explicit"])("025 %s gap 有准确占位，连梁不跨空白也不跨真实拍线", kind => {
    // 模拟旧推移产生的 120 tick 缝隙；这类非格点起音本身合法，不能强行四舍五入。
    const events = [note(1920), note(2280), note(2520), note(2760), note(3000)];
    if (kind === "explicit") events.splice(1, 0, { ...note(2160, "thirtySecond"), kind: "gap", items: [] });
    const { document, measure } = fixture(events);
    expect(validateNumberedVoice(measure.numberedVoice, 3840)).toBeNull();
    const range = planNumberedInputRanges(measure).find(range => range.startTick === 2160)!;
    expect(range.endTick).toBe(2280);
    const layout = buildLayout(document, { purpose: "editing", density: "compact", systemWidth: 420 });
    const output = layout.systems[0]!.measures[0]!;
    const slot = output.numberedInputSlots!.find(slot => slot.startTick === 2160)!;
    expect(slot.endTick).toBe(2280);
    const frames = output.numberedNotation!;
    const first = frames.find(frame => frame.eventId === "e1920")!;
    const next = frames.find(frame => frame.eventId === "e2280")!;
    expect(first.lines!.every(line => !line.shared)).toBe(true);
    expect(slot.anchorX).toBeGreaterThan(first.labels[0]!.bounds.x + first.labels[0]!.bounds.width);
    expect(slot.anchorX).toBeLessThan(next.labels[0]!.bounds.x);
    const shared = next.lines!.filter(line => line.shared);
    expect(shared).toHaveLength(2);
    expect(shared.every(line => line.x2 < frames.find(frame => frame.eventId === "e3000")!.labels[0]!.x)).toBe(true);
  });
});
