import { describe, expect, it } from "vitest";
import {
  buildLayout, EXAMPLE_MVP_7_2_DOCUMENT, hitTestNumbered, layoutParagraphFocus,
  type ILXMNumberedEvent,
} from "../../src";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = []; track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.lyrics = []; measure.chordSymbols = [];
  measure.numberedVoice = { tuplets: [], events: [
    { id: "eighth", tick: 0, kind: "notes", rhythm: { base: "eighth", dots: 0 }, items: [{ id: "i0", token: "1" }] },
    { id: "rest", tick: 480, kind: "rest", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: "ir", token: "0" }] },
    { id: "sixteenth", tick: 720, kind: "notes", rhythm: { base: "sixteenth", dots: 0 }, items: [{ id: "i1", token: "2" }] },
    { id: "continuation", tick: 960, kind: "continuation", rhythm: { base: "quarter", dots: 0 }, items: [{ id: "ic", token: "-" }] },
    { id: "gap", tick: 1920, kind: "gap", rhythm: { base: "quarter", dots: 0 }, items: [] },
    { id: "low", tick: 2880, kind: "notes", rhythm: { base: "quarter", dots: 0 }, items: [{ id: "i2", token: "3.." }] },
  ] satisfies ILXMNumberedEvent[] };
  return { document, track, measure };
};

describe("BUG043 简谱统一窄选框", () => {
  it.each(["compact", "comfortable"] as const)("%s：音符、休止、延音和空位统一18×20蓝框，不受减时线及八度点撑高", density => {
    const { document, track, measure } = fixture();
    const before = JSON.stringify(document);
    for (const systemWidth of [180, 900]) {
      const layout = buildLayout(document, { purpose: "editing", density, systemWidth });
      const m = layout.systems[0]!.measures[0]!;
      const frames = measure.numberedVoice.events.map(event => layoutParagraphFocus(layout, {
        trackId: track.id, measureId: measure.id, kind: "numbered", eventId: event.id,
      })!);
      for (const [index, frame] of frames.entries()) {
        const slot = m.numberedSlots.find(slot => slot.id === measure.numberedVoice.events[index]!.id)!;
        expect(frame.width).toBe(18);
        expect(frame.x + frame.width / 2).toBeCloseTo(slot.x);
        expect(frame.y).toBe(frames[0]!.y);
        expect(frame.height).toBe(frames[0]!.height);
        expect(frame.height).toBe(20);
      }
      expect(frames[0]!.y).toBe(layout.systems[0]!.numberedRow!.y - 2);
      const gap = m.numberedInputSlots!.find(slot => slot.startTick === 1920)!;
      // 视觉框缩窄，但点击目标和窗口仍来自原始槽。
      expect(gap.width).toBe(24);
      expect(hitTestNumbered(layout, { x: gap.anchorX, y: gap.y + gap.height / 2 })).toEqual(gap.target);
      expect(layoutParagraphFocus(layout, { ...gap.target, kind: "numbered" })).toEqual(frames[4]);
    }
    expect(JSON.stringify(document)).toBe(before);
  });

  it("添加三层减时线与多重八度点不改变当前或同一行其他位置的蓝框高度", () => {
    const { document, track, measure } = fixture();
    const focus = () => {
      const layout = buildLayout(document, { purpose: "editing" });
      return ["eighth", "gap", "low"].map(eventId => layoutParagraphFocus(layout, {
        trackId: track.id, measureId: measure.id, kind: "numbered", eventId,
      })!);
    };
    const before = focus();
    measure.numberedVoice.events.at(-1)!.items[0]!.token = "3'''";
    measure.numberedVoice.events.at(-1)!.rhythm = { base: "thirtySecond", dots: 0 };
    const after = focus();
    for (const [index, frame] of after.entries()) {
      expect(frame.height).toBe(20);
      expect(frame.width).toBe(before[index]!.width);
      expect(frame.y - after[0]!.y).toBe(0);
    }
  });

  it("变音和多音按正文扩宽，长音延时线不参与选框；成员焦点保持一致", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [{ id: "wide", tick: 0, kind: "notes", rhythm: { base: "half", dots: 0 },
      items: [{ id: "a", token: "#4'''" }, { id: "b", token: "b7.." }] }];
    const layout = buildLayout(document, { purpose: "editing", density: "compact" });
    const target = { trackId: track.id, measureId: measure.id, kind: "numbered" as const, eventId: "wide" };
    const all = layoutParagraphFocus(layout, target)!;
    const notation = layout.systems[0]!.measures[0]!.numberedNotation![0]!;
    expect(all.width).toBeGreaterThan(18);
    expect(all.height).toBe(20);
    for (const item of notation.itemBounds!) {
      const focus = layoutParagraphFocus(layout, { ...target, itemId: item.itemId })!;
      expect(focus.width).toBeLessThan(all.width);
      expect(focus.x).toBeLessThanOrEqual(item.bounds.x);
      expect(focus.x + focus.width).toBeGreaterThanOrEqual(item.bounds.x + item.bounds.width);
      expect(focus.y).toBe(all.y);
      expect(focus.height).toBe(all.height);
    }
  });

  it.each(["notes", "rest"] as const)("%s 的长音、附点、延时横线不撑宽选框", kind => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [{ id: "long", tick: 0, kind, rhythm: { base: "half", dots: 1 },
      items: [{ id: "long-item", token: kind === "rest" ? "0" : "3" }] }];
    const layout = buildLayout(document, { purpose: "editing" });
    const focus = layoutParagraphFocus(layout, { trackId: track.id, measureId: measure.id, kind: "numbered", eventId: "long" })!;
    expect(focus.width).toBe(18);
    expect(focus.height).toBe(20);
    const notation = layout.systems[0]!.measures[0]!.numberedNotation![0]!;
    expect(notation.bounds.width).toBeGreaterThan(focus.width);
    // 原长音节奏区域依然可命中，数字和延时区域定位到同一个窄框。
    const hit = hitTestNumbered(layout, { x: notation.bounds.x + notation.bounds.width - 0.01, y: notation.bounds.y + notation.bounds.height / 2 })!;
    expect(layoutParagraphFocus(layout, { ...hit, kind: "numbered" })).toEqual(focus);
  });
});
