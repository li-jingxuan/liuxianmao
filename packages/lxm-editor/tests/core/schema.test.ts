import { describe, expect, it } from "vitest";

import { MAX_FRET } from "../../src/core/constants";
import {
  LXMMeasureSchema,
  LXMNoteSchema,
  LXMRhythmSchema,
} from "../../src/core/schema";

const createValidMeasure = () => ({
  id: "measure-schema-test",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats: [],
});

describe("core schema", () => {
  it("允许常见小节线类型通过小节 schema", () => {
    const result = LXMMeasureSchema.safeParse({
      ...createValidMeasure(),
      barline: "repeatEnd",
    });

    expect(result.success).toBe(true);
  });

  it("拒绝未知小节线类型", () => {
    const result = LXMMeasureSchema.safeParse({
      ...createValidMeasure(),
      barline: "legacyRepeat",
    });

    expect(result.success).toBe(false);
  });

  it("拒绝 schema 未声明的额外字段", () => {
    const result = LXMRhythmSchema.safeParse({
      base: "quarter",
      dots: 0,
      swing: true,
    });

    expect(result.success).toBe(false);
  });

  it("限制音符品位不能超过最大品位", () => {
    const result = LXMNoteSchema.safeParse({
      id: "note-over-max-fret",
      string: 1,
      fret: MAX_FRET + 1,
    });

    expect(result.success).toBe(false);
  });
});
