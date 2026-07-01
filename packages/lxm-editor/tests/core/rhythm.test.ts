import { describe, expect, it } from "vitest";

import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
} from "../../src/core/rhythm";

describe("calculateRhythmTicks", () => {
  it("按基础时值换算 tick 数", () => {
    expect(calculateRhythmTicks({ base: "whole", dots: 0 })).toEqual({
      ok: true,
      ticks: 3840,
    });
    expect(calculateRhythmTicks({ base: "quarter", dots: 0 })).toEqual({
      ok: true,
      ticks: 960,
    });
    expect(calculateRhythmTicks({ base: "thirtySecond", dots: 0 })).toEqual({
      ok: true,
      ticks: 120,
    });
  });

  it("支持单附点和双附点时值", () => {
    expect(calculateRhythmTicks({ base: "quarter", dots: 1 })).toEqual({
      ok: true,
      ticks: 1440,
    });
    expect(calculateRhythmTicks({ base: "eighth", dots: 2 })).toEqual({
      ok: true,
      ticks: 840,
    });
  });

  it("不支持超过双附点的时值", () => {
    expect(calculateRhythmTicks({ base: "quarter", dots: 3 })).toEqual({
      ok: false,
      code: "UNSUPPORTED_DOTS",
    });
  });
});

describe("getMeasureCapacityTicks", () => {
  it("根据拍号计算完整小节容量", () => {
    expect(getMeasureCapacityTicks({ numerator: 4, denominator: 4 })).toBe(3840);
    expect(getMeasureCapacityTicks({ numerator: 3, denominator: 4 })).toBe(2880);
    expect(getMeasureCapacityTicks({ numerator: 6, denominator: 8 })).toBe(2880);
  });
});
