import { describe, expect, it, vi } from "vitest";

import {
  createMeasureRestBeats,
  createRestBeats,
} from "../../src/core/rest-beats";

const createSequentialIdFactory = () => {
  let nextId = 1;
  return () => `beat-${nextId++}`;
};

describe("createMeasureRestBeats", () => {
  it.each([
    {
      timeSignature: { numerator: 4, denominator: 4 },
      base: "quarter",
      ticks: [0, 960, 1920, 2880],
    },
    {
      timeSignature: { numerator: 3, denominator: 4 },
      base: "quarter",
      ticks: [0, 960, 1920],
    },
    {
      timeSignature: { numerator: 6, denominator: 8 },
      base: "eighth",
      ticks: [0, 480, 960, 1440, 1920, 2400],
    },
    {
      timeSignature: { numerator: 2, denominator: 2 },
      base: "half",
      ticks: [0, 1920],
    },
  ] as const)(
    "$timeSignature.numerator/$timeSignature.denominator 按单位拍创建休止 beat",
    ({ timeSignature, base, ticks }) => {
      const rests = createMeasureRestBeats(
        timeSignature,
        createSequentialIdFactory(),
      );

      expect(rests).toEqual(
        ticks.map((tick, index) => ({
          id: `beat-${index + 1}`,
          tick,
          rhythm: { base, dots: 0 },
          kind: "rest",
          notes: [],
        })),
      );
    },
  );

  it("非标准分母无法表达单位拍时沿用整段静音分解", () => {
    expect(
      createMeasureRestBeats(
        { numerator: 3, denominator: 3 },
        createSequentialIdFactory(),
      ),
    ).toEqual([
      {
        id: "beat-1",
        tick: 0,
        rhythm: { base: "whole", dots: 0 },
        kind: "rest",
        notes: [],
      },
    ]);
  });

  it("整小节容量无法表达时返回 null 且不消费 ID", () => {
    const createBeatId = vi.fn(() => "unused");

    expect(
      createMeasureRestBeats({ numerator: 1, denominator: 64 }, createBeatId),
    ).toBeNull();
    expect(createBeatId).not.toHaveBeenCalled();
  });
});

describe("createRestBeats", () => {
  it("任意静音时长仍按最长基础时值优先分解", () => {
    expect(createRestBeats(120, 2880, createSequentialIdFactory())).toEqual([
      {
        id: "beat-1",
        tick: 120,
        rhythm: { base: "half", dots: 0 },
        kind: "rest",
        notes: [],
      },
      {
        id: "beat-2",
        tick: 2040,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
        notes: [],
      },
    ]);
  });
});
