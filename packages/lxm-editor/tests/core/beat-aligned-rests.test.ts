import { describe, expect, it, vi } from "vitest";
import { createBeatAlignedRestBeats } from "../../src/core/rest-beats";
import { reconcileMeasureTimeline } from "../../src/core/measure-timeline";
import { changeMeasureBeatRhythm } from "../../src/core/rhythm-change";
import type { ILXMBeat, ILXMMeasure } from "../../src/core/types";

const signature = { numerator: 4, denominator: 4 };
const makeId = () => {
  let id = 0;
  return () => `rest-${++id}`;
};
const summary = (beats: ILXMBeat[]) =>
  beats.map((beat) => [beat.tick, beat.rhythm.base]);
const beat = (
  id: string,
  tick: number,
  base: ILXMBeat["rhythm"]["base"],
  kind: ILXMBeat["kind"] = "rest",
): ILXMBeat => ({
  id,
  tick,
  rhythm: { base, dots: 0 },
  kind,
  notes: kind === "notes" ? [{ id: `${id}-note`, string: 1, fret: 3 }] : [],
});
const measure = (beats: ILXMBeat[]): ILXMMeasure => ({
  id: "measure",
  timeSignature: signature,
  barline: "single",
  beats,
  tuplets: [],
  numberedVoice: { events: [], tuplets: [] },
  lyrics: [],
  chordSymbols: [],
});

describe("六线谱自动补空按单位拍分段", () => {
  it("4/4剩两拍补两个四分休止", () => {
    const rests = createBeatAlignedRestBeats(1920, 1920, signature, makeId())!;
    expect(summary(rests)).toEqual([
      [1920, "quarter"],
      [2880, "quarter"],
    ]);
    expect(
      rests.every((beat) => beat.kind === "rest" && !beat.notes.length),
    ).toBe(true);
  });
  it("非整拍起点先补到拍界，不让休止跨过拍界", () => {
    expect(
      summary(createBeatAlignedRestBeats(480, 3360, signature, makeId())!),
    ).toEqual([
      [480, "eighth"],
      [960, "quarter"],
      [1920, "quarter"],
      [2880, "quarter"],
    ]);
    expect(
      summary(createBeatAlignedRestBeats(720, 720, signature, makeId())!),
    ).toEqual([
      [720, "sixteenth"],
      [960, "eighth"],
    ]);
  });
  it("按拍号单位分段，6/8每个空位为八分，3/4为四分", () => {
    expect(
      summary(
        createBeatAlignedRestBeats(
          480,
          2400,
          { numerator: 6, denominator: 8 },
          makeId(),
        )!,
      ),
    ).toEqual([
      [480, "eighth"],
      [960, "eighth"],
      [1440, "eighth"],
      [1920, "eighth"],
      [2400, "eighth"],
    ]);
    expect(
      summary(
        createBeatAlignedRestBeats(
          960,
          1920,
          { numerator: 3, denominator: 4 },
          makeId(),
        )!,
      ),
    ).toEqual([
      [960, "quarter"],
      [1920, "quarter"],
    ]);
  });
  it("不可表达的时长整次失败且不消耗ID，零时长无需补空", () => {
    const id = vi.fn(makeId());
    expect(createBeatAlignedRestBeats(0, 961, signature, id)).toBeNull();
    expect(id).not.toHaveBeenCalled();
    expect(createBeatAlignedRestBeats(0, 0, signature, id)).toEqual([]);
  });
  it("缩短音符后重建的尾部逐拍可选，原音和简谱不改身份", () => {
    const input = measure([
      beat("note", 0, "half", "notes"),
      beat("tail", 1920, "half"),
    ]);
    const snapshot = structuredClone(input);
    const result = changeMeasureBeatRhythm(
      input,
      "note",
      { base: "quarter", dots: 0 },
      makeId(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(summary(result.measure.beats)).toEqual([
      [0, "quarter"],
      [960, "quarter"],
      [1920, "quarter"],
      [2880, "quarter"],
    ]);
    expect(result.measure.beats[0]!.notes).toEqual(input.beats[0]!.notes);
    expect(result.measure.numberedVoice).toEqual(input.numberedVoice);
    expect(input).toEqual(snapshot);
  });
  it("用户明确修改的长休止保留，已有匹配尾部不重建ID", () => {
    const input = measure([
      beat("note", 0, "quarter", "notes"),
      beat("explicit", 960, "half"),
      beat("tail", 2880, "quarter"),
    ]);
    const result = reconcileMeasureTimeline(input, {
      createBeatId: makeId(),
      protectedBeatIds: new Set(["explicit"]),
    });
    expect(result).toMatchObject({ ok: true, measure: input });
    if (result.ok) expect(result.measure.beats[1]).toBe(input.beats[1]);
  });
});
