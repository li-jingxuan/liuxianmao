import { describe, expect, it } from "vitest";
import { applyScoreCommand } from "../../src/core/commands/commands";
import { planNumberedInputRanges } from "../../src/core/numbered/numbered-input-ranges";
import { validateNumberedVoice } from "../../src/core/numbered/numbered-rhythm";
import { buildLayout } from "../../src/layout/index";
import example from "../../example/example-mvp7.2";

const fixture = () => {
  const document = structuredClone(example);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.numberedMarks = [{ id: "retained-mark", type: "fermata", eventId: "later" }];
  track.techniques = [];
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.lyrics = [{ id: "retained-lyric", eventId: "later", verse: 1, text: "词" }];
  measure.numberedVoice = { events: [
    { id: "shortened", tick: 0, rhythm: { base: "quarter", dots: 0 }, kind: "notes", items: [{ id: "first-item", token: "3" }] },
    { id: "later", tick: 960, rhythm: { base: "quarter", dots: 0 }, kind: "notes", items: [{ id: "later-item", token: "5" }] },
  ], tuplets: [] };
  const command = { type: "numbered.event.setRhythm" as const, trackId: track.id, measureId: measure.id, eventId: "shortened", rhythm: { base: "sixteenth" as const, dots: 0 } };
  return { document, track, measure, command };
};

describe("BUG-025 再验收：缩短后的空位保持所选细分", () => {
  it("四分改十六分保留原音并生成三个可编辑十六分空位，后音和关联不变", () => {
    const { document, track, measure, command } = fixture();
    const result = applyScoreCommand(document, command);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const afterTrack = result.document.score.tracks[0]!;
    const after = afterTrack.measures[0]!;
    expect(after.numberedVoice.events.filter(event => event.tick < 960).map(event => [event.tick, event.kind, event.rhythm])).toEqual([
      [0, "notes", { base: "sixteenth", dots: 0 }],
      [240, "gap", { base: "sixteenth", dots: 0 }],
      [480, "gap", { base: "sixteenth", dots: 0 }],
      [720, "gap", { base: "sixteenth", dots: 0 }],
    ]);
    expect(after.numberedVoice.events.find(event => event.id === "later")).toEqual(measure.numberedVoice.events[1]);
    expect(after.lyrics).toEqual(measure.lyrics);
    expect(afterTrack.numberedMarks).toEqual(track.numberedMarks);
    expect(validateNumberedVoice(after.numberedVoice, 3840)).toBeNull();
    expect(planNumberedInputRanges(after).filter(range => range.startTick < 960).map(range => [range.startTick, range.endTick])).toEqual([[240, 480], [480, 720], [720, 960]]);
    const layout = buildLayout(result.document, { purpose: "editing", density: "compact", systemWidth: 420 });
    const slots = layout.systems[0]!.measures[0]!.numberedInputSlots!.filter(slot => slot.startTick < 960);
    expect(slots.map(slot => slot.startTick)).toEqual([240, 480, 720]);
    expect(slots.every(slot => slot.width === 24)).toBe(true);
    expect(slots.every((slot, index) => index === 0 || slot.x > slots[index - 1]!.x + slots[index - 1]!.width)).toBe(true);
    const repeated = applyScoreCommand(result.document, command);
    expect(repeated.ok).toBe(true);
    if (repeated.ok) expect(repeated.document).toEqual(result.document);
  });

  it("连续输入逐个覆盖四个十六分位置，不越过本拍；空位身份保持", () => {
    const { document, command, track, measure } = fixture();
    const shortened = applyScoreCommand(document, command);
    expect(shortened.ok).toBe(true);
    if (!shortened.ok) return;
    const before = shortened.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    const result = applyScoreCommand(shortened.document, {
      type: "numbered.sequence.set", trackId: track.id, measureId: measure.id, eventId: "shortened", allowOverwrite: true,
      items: ["5", "6", "7", "1"].map(token => ({ kind: "set" as const, tokens: [token] })),
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const events = result.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(events.filter(event => event.tick < 960).map(event => [event.tick, event.items[0]?.token])).toEqual([[0, "5"], [240, "6"], [480, "7"], [720, "1"]]);
    expect(events.map(event => event.id)).toEqual(before.map(event => event.id));
    expect(events.find(event => event.id === "later")).toEqual(before.find(event => event.id === "later"));
  });

  it("每个释放空位均可独立写入，文档往返后仍有三个独立时间窗", () => {
    const { document, command, track, measure } = fixture();
    const shortened = applyScoreCommand(document, command);
    expect(shortened.ok).toBe(true);
    if (!shortened.ok) return;
    let current = JSON.parse(JSON.stringify(shortened.document)) as typeof document;
    const gaps = current.score.tracks[0]!.measures[0]!.numberedVoice.events.filter(event => event.kind === "gap" && event.tick < 960);
    expect(gaps).toHaveLength(3);
    for (const [index, gap] of gaps.entries()) {
      const inserted = applyScoreCommand(current, { type: "numbered.event.set", trackId: track.id, measureId: measure.id, eventId: gap.id, tokens: [String(index + 1)] });
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) return;
      current = inserted.document;
    }
    expect(current.score.tracks[0]!.measures[0]!.numberedVoice.events.filter(event => event.tick < 960).map(event => [event.tick, event.items[0]?.token])).toEqual([[0, "3"], [240, "1"], [480, "2"], [720, "3"]]);
  });

  it("附点短时值保留完整格和可编码尾格，不移动原有后方空位", () => {
    const { document, command, measure } = fixture();
    measure.numberedVoice.events.splice(1, 0, { id: "existing-gap", tick: 960, kind: "gap", rhythm: { base: "quarter", dots: 0 }, items: [] });
    measure.numberedVoice.events.at(-1)!.tick = 1920;
    const result = applyScoreCommand(document, { ...command, rhythm: { base: "sixteenth", dots: 1 } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const events = result.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(events.filter(event => event.tick < 960).map(event => [event.tick, event.kind, event.rhythm])).toEqual([
      [0, "notes", { base: "sixteenth", dots: 1 }],
      [360, "gap", { base: "sixteenth", dots: 1 }],
      [720, "gap", { base: "sixteenth", dots: 0 }],
    ]);
    expect(events.find(event => event.id === "existing-gap")).toEqual(measure.numberedVoice.events[1]);
    expect(events.find(event => event.id === "later")).toEqual(measure.numberedVoice.events[2]);
  });

  it("缩为三十二分后仍可加附点，不可编码的60 tick尾量保留真实空白", () => {
    const { document, command } = fixture();
    const shortened = applyScoreCommand(document, { ...command, rhythm: { base: "thirtySecond", dots: 0 } });
    expect(shortened.ok).toBe(true);
    if (!shortened.ok) return;
    const dotted = applyScoreCommand(shortened.document, { ...command, rhythm: { base: "thirtySecond", dots: 1 } });
    expect(dotted.ok, JSON.stringify(dotted)).toBe(true);
    if (!dotted.ok) return;
    const after = dotted.document.score.tracks[0]!.measures[0]!;
    expect(after.numberedVoice.events[0]!.rhythm).toEqual({ base: "thirtySecond", dots: 1 });
    expect(after.numberedVoice.events.slice(1).map(event => event.tick)).toEqual([240, 360, 480, 600, 720, 840, 960]);
    expect(planNumberedInputRanges(after)[0]).toMatchObject({ startTick: 180, endTick: 240 });
    expect(validateNumberedVoice(after.numberedVoice, 3840)).toBeNull();
  });
});
