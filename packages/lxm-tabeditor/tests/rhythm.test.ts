import { describe, expect, it } from "vitest";
import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
  partitionTickRangeToRhythms,
} from "../src/core/rhythm";
import { validateScoreSemantics } from "../src/core/validation";
import { createExampleDocument } from "../src/testing/example-document";

describe("整数 tick 节奏体系", () => {
  it.each([
    ["quarter", 1, undefined, 1440],
    ["quarter", 2, undefined, 1680],
    ["eighth", 0, { actualNotes: 2, normalNotes: 3 }, 720],
    ["eighth", 0, { actualNotes: 3, normalNotes: 2 }, 320],
    ["eighth", 0, { actualNotes: 4, normalNotes: 3 }, 360],
    ["quarter", 0, { actualNotes: 5, normalNotes: 4 }, 768],
    ["quarter", 0, { actualNotes: 5, normalNotes: 3 }, 576],
    ["eighth", 0, { actualNotes: 6, normalNotes: 4 }, 320],
  ] as const)(
    "%s 附点 %s 连音 %o 得到 %s tick",
    (base, dots, tuplet, expected) => {
      expect(calculateRhythmTicks({ base, dots }, tuplet)).toEqual({
        ok: true,
        ticks: expected,
      });
    },
  );

  it("拒绝无法整除的附点连音组合", () => {
    expect(
      calculateRhythmTicks(
        { base: "thirtySecond", dots: 2 },
        { actualNotes: 4, normalNotes: 3 },
      ),
    ).toEqual({ ok: false, code: "NON_INTEGER_RHYTHM_TICKS" });
  });

  it("正确计算常见拍号容量", () => {
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

  it("把 tick 区间切分成可落盘的合法时值片段", () => {
    expect(
      partitionTickRangeToRhythms(0, 240, { numerator: 4, denominator: 4 }),
    ).toEqual([{ tick: 0, rhythm: { base: "sixteenth", dots: 0 } }]);

    expect(
      partitionTickRangeToRhythms(360, 960, { numerator: 4, denominator: 4 }),
    ).toEqual([
      { tick: 360, rhythm: { base: "eighth", dots: 0 } },
      { tick: 840, rhythm: { base: "thirtySecond", dots: 0 } },
    ]);
  });

  it("普通小节必须完整，弱起小节允许不足但不能溢出", () => {
    const document = createExampleDocument();
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.beats.pop();
    expect(
      validateScoreSemantics(document).some(
        (issue) => issue.code === "INVALID_MEASURE_CAPACITY",
      ),
    ).toBe(true);
    measure.pickup = true;
    expect(
      validateScoreSemantics(document).some(
        (issue) => issue.code === "INVALID_MEASURE_CAPACITY",
      ),
    ).toBe(false);
  });
});
