import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../src";
import { planNumberedInputRanges } from "../../src/core/numbered/numbered-input-ranges";

const fixture = () => {
  const measure = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT.score.tracks[0]!.measures[0]!);
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.tuplets = [];
  measure.numberedVoice = { events: [], tuplets: [] };
  measure.beats = [
    { id: "a", tick: 0, kind: "notes", notes: [], rhythm: { base: "eighth", dots: 1 } },
    { id: "b", tick: 720, kind: "notes", notes: [], rhythm: { base: "sixteenth", dots: 0 } },
    { id: "c", tick: 960, kind: "notes", notes: [], rhythm: { base: "half", dots: 0 } },
    { id: "d", tick: 2880, kind: "notes", notes: [], rhythm: { base: "quarter", dots: 0 } },
  ];
  return measure;
};

describe("空简谱借用 TAB 录入窗口", () => {
  it("保留附点和跨拍长时值，不拆成拍号单位，且不修改谱面", () => {
    const measure = fixture(), before = structuredClone(measure);
    expect(planNumberedInputRanges(measure)).toEqual(measure.beats.map((beat, index) => ({
      startTick: beat.tick,
      endTick: measure.beats[index + 1]?.tick ?? 3840,
      rhythm: beat.rhythm,
    })));
    expect(measure).toEqual(before);
  });
  it("whole 仍是单一完整窗口", () => {
    const measure = fixture();
    measure.beats = [{ ...measure.beats[0]!, rhythm: { base: "whole", dots: 0 } }];
    expect(planNumberedInputRanges(measure)).toEqual([{ startTick: 0, endTick: 3840, rhythm: { base: "whole", dots: 0 } }]);
  });
  it("已有事件与持久 gap 保留自身时值，不被 TAB 长音覆盖", () => {
    const measure = fixture();
    measure.numberedVoice.events = [{ id: "gap", tick: 1920, kind: "gap", rhythm: { base: "eighth", dots: 0 }, items: [] }];
    const ranges = planNumberedInputRanges(measure);
    expect(ranges.find(range => range.eventId === "gap")).toEqual({ eventId: "gap", startTick: 1920, endTick: 2400, rhythm: { base: "eighth", dots: 0 } });
    expect(ranges.filter(range => !range.eventId).every(range => range.endTick <= 1920 || range.startTick >= 2400)).toBe(true);
  });
  it("连音成员不会脱离比例借出普通时值", () => {
    const measure = fixture();
    measure.beats = [0, 320, 640].map((tick, index) => ({ ...measure.beats[0]!, id: `triplet-${index}`, tick, rhythm: { base: "eighth", dots: 0 } }));
    measure.tuplets = [{ id: "triplet", beatIds: measure.beats.map(beat => beat.id), ratio: { actual: 3, normal: 2 } }];
    expect(planNumberedInputRanges(measure).find(range => range.startTick === 0)).not.toMatchObject({ endTick: 480, rhythm: { base: "eighth", dots: 0 } });
  });
});
