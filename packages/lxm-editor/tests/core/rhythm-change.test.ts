import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { changeMeasureBeatRhythm } from "../../src/core/rhythm-change";
import type { ILXMBeat, ILXMMeasure } from "../../src/core/types";

/** 构造只供领域规划测试使用的 beat，避免测试依赖页面或 layout。 */
const beat = (
  id: string,
  tick: number,
  base: ILXMBeat["rhythm"]["base"],
  kind: ILXMBeat["kind"] = "notes",
  dots = 0,
): ILXMBeat => ({
  id,
  tick,
  rhythm: { base, dots },
  kind,
  notes: kind === "notes" ? [{ id: `${id}-note`, string: 1, fret: 0 }] : [],
});

const measureWithTrailingRest = (): ILXMMeasure => ({
  id: "measure-with-tail-rest",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats: [
    beat("beat-1", 0, "quarter"),
    beat("beat-2", 960, "quarter"),
    beat("tail-rest", 1920, "half", "rest"),
  ],
});

const createBeatIdFactory = () => {
  let index = 0;
  return () => `generated-rest-${++index}`;
};

describe("changeMeasureBeatRhythm", () => {
  it("第 6 小节首个八分变四分时均匀压缩最近三个后续 beat", () => {
    const source = structuredClone(EXAMPLE_MVP_2.score.tracks[0]!.measures[5]!);
    const snapshot = structuredClone(source);

    const result = changeMeasureBeatRhythm(
      source,
      "mvp2-beat-6-1",
      { base: "quarter", dots: 0 },
      createBeatIdFactory(),
    );

    expect(result).toMatchObject({
      ok: true,
      compressedBeatIds: ["mvp2-beat-6-2", "mvp2-beat-6-3", "mvp2-beat-6-4"],
    });
    if (!result.ok) return;

    expect(
      result.measure.beats.map(({ tick, rhythm }) => ({ tick, rhythm })),
    ).toEqual([
      { tick: 0, rhythm: { base: "quarter", dots: 0 } },
      { tick: 960, rhythm: { base: "thirtySecond", dots: 0 } },
      { tick: 1080, rhythm: { base: "thirtySecond", dots: 0 } },
      { tick: 1200, rhythm: { base: "sixteenth", dots: 0 } },
      { tick: 1440, rhythm: { base: "eighth", dots: 0 } },
      { tick: 1920, rhythm: { base: "quarter", dots: 0 } },
      { tick: 2880, rhythm: { base: "quarter", dots: 0 } },
    ]);
    expect(source).toEqual(snapshot);
  });

  it("末尾休止足够时只重建休止缓冲，不压缩 notes beat", () => {
    const source = measureWithTrailingRest();
    const result = changeMeasureBeatRhythm(
      source,
      "beat-1",
      { base: "half", dots: 0 },
      createBeatIdFactory(),
    );

    expect(result).toMatchObject({ ok: true, compressedBeatIds: [] });
    if (!result.ok) return;
    expect(
      result.measure.beats.map(({ id, tick, rhythm, kind }) => ({
        id,
        tick,
        rhythm,
        kind,
      })),
    ).toEqual([
      {
        id: "beat-1",
        tick: 0,
        rhythm: { base: "half", dots: 0 },
        kind: "notes",
      },
      {
        id: "beat-2",
        tick: 1920,
        rhythm: { base: "quarter", dots: 0 },
        kind: "notes",
      },
      {
        id: "generated-rest-1",
        tick: 2880,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
    ]);
  });

  it("目标自身是尾部休止时保留目标 ID，并在其后补齐新休止", () => {
    const result = changeMeasureBeatRhythm(
      measureWithTrailingRest(),
      "tail-rest",
      { base: "quarter", dots: 0 },
      createBeatIdFactory(),
    );

    expect(result).toMatchObject({ ok: true, compressedBeatIds: [] });
    if (!result.ok) return;
    expect(result.measure.beats.slice(2)).toEqual([
      expect.objectContaining({
        id: "tail-rest",
        tick: 1920,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      }),
      expect.objectContaining({
        id: "generated-rest-1",
        tick: 2880,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      }),
    ]);
  });

  it("为同一释放 tick 保留不同最大级数状态，避免提前剪枝错过最终最优解", () => {
    const source: ILXMMeasure = {
      id: "measure-dp-pareto",
      timeSignature: { numerator: 6, denominator: 4 },
      barline: "single",
      chordSymbols: [],
      beats: [
        beat("before", 0, "eighth"),
        beat("target", 480, "thirtySecond"),
        beat("sixteenth-1", 600, "sixteenth"),
        beat("sixteenth-2", 840, "sixteenth"),
        beat("sixteenth-3", 1080, "sixteenth"),
        beat("sixteenth-4", 1320, "sixteenth"),
        beat("eighth", 1560, "eighth"),
        beat("half", 2040, "half"),
        beat("tail-rest-1", 3960, "quarter", "rest", 1),
        beat("tail-rest-2", 5400, "sixteenth", "rest", 1),
      ],
    };

    const result = changeMeasureBeatRhythm(
      source,
      "target",
      { base: "whole", dots: 0 },
      createBeatIdFactory(),
    );

    expect(result).toMatchObject({
      ok: true,
      compressedBeatIds: ["sixteenth-1", "eighth", "half"],
    });
    if (!result.ok) return;
    expect(
      result.measure.beats
        .filter((item) => ["sixteenth-1", "eighth", "half"].includes(item.id))
        .map(({ id, rhythm }) => ({ id, rhythm })),
    ).toEqual([
      {
        id: "sixteenth-1",
        rhythm: { base: "thirtySecond", dots: 0 },
      },
      { id: "eighth", rhythm: { base: "thirtySecond", dots: 0 } },
      { id: "half", rhythm: { base: "eighth", dots: 0 } },
    ]);
  });

  it("没有精确压缩方案时失败且不修改输入 measure", () => {
    const source = structuredClone(EXAMPLE_MVP_2.score.tracks[0]!.measures[5]!);
    const snapshot = structuredClone(source);

    const result = changeMeasureBeatRhythm(
      source,
      "mvp2-beat-6-7",
      { base: "half", dots: 0 },
      createBeatIdFactory(),
    );

    expect(result).toEqual({
      ok: false,
      code: "FOLLOWING_BEATS_CANNOT_COMPRESS",
    });
    expect(source).toEqual(snapshot);
  });
});
