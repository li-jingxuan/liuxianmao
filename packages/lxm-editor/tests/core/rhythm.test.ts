import { describe, expect, it } from "vitest";

import {
  calculateRhythmTicks,
  getTimeSignatureBeatGroupTicks,
  getMeasureCapacityTicks,
  isEditableTimeSignature,
  isSameTimeSignature,
  getShorterRhythmOptions,
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
    expect(getMeasureCapacityTicks({ numerator: 4, denominator: 4 })).toBe(
      3840,
    );
    expect(getMeasureCapacityTicks({ numerator: 3, denominator: 4 })).toBe(
      2880,
    );
    expect(getMeasureCapacityTicks({ numerator: 6, denominator: 8 })).toBe(
      2880,
    );
  });
});

describe("拍号 profile", () => {
  it("按值比较拍号并只开放首批可编辑集合", () => {
    expect(
      isSameTimeSignature(
        { numerator: 3, denominator: 4 },
        { numerator: 3, denominator: 4 },
      ),
    ).toBe(true);
    expect(isEditableTimeSignature({ numerator: 2, denominator: 4 })).toBe(
      true,
    );
    expect(isEditableTimeSignature({ numerator: 6, denominator: 8 })).toBe(
      true,
    );
    expect(isEditableTimeSignature({ numerator: 5, denominator: 8 })).toBe(
      false,
    );
  });

  it("3/4 与 6/8 容量相同但返回不同的音乐拍组", () => {
    expect(
      getTimeSignatureBeatGroupTicks({ numerator: 3, denominator: 4 }),
    ).toEqual([960, 960, 960]);
    expect(
      getTimeSignatureBeatGroupTicks({ numerator: 6, denominator: 8 }),
    ).toEqual([1440, 1440]);
    expect(
      getTimeSignatureBeatGroupTicks({ numerator: 5, denominator: 8 }),
    ).toBeNull();
  });
});

describe("getShorterRhythmOptions", () => {
  it("按基础时值顺序返回所有更短候选及缩短级数", () => {
    expect(getShorterRhythmOptions({ base: "whole", dots: 0 })).toEqual([
      { rhythm: { base: "half", dots: 0 }, level: 1, ticks: 1920 },
      { rhythm: { base: "quarter", dots: 0 }, level: 2, ticks: 960 },
      { rhythm: { base: "eighth", dots: 0 }, level: 3, ticks: 480 },
      { rhythm: { base: "sixteenth", dots: 0 }, level: 4, ticks: 240 },
      { rhythm: { base: "thirtySecond", dots: 0 }, level: 5, ticks: 120 },
    ]);
  });

  it("压缩候选保留原附点数且不修改输入对象", () => {
    const rhythm = { base: "eighth", dots: 1 } as const;

    expect(getShorterRhythmOptions(rhythm)).toEqual([
      { rhythm: { base: "sixteenth", dots: 1 }, level: 1, ticks: 360 },
      { rhythm: { base: "thirtySecond", dots: 1 }, level: 2, ticks: 180 },
    ]);
    expect(rhythm).toEqual({ base: "eighth", dots: 1 });
  });

  it("三十二分音符没有更短的可表示候选", () => {
    expect(getShorterRhythmOptions({ base: "thirtySecond", dots: 2 })).toEqual(
      [],
    );
  });
});
