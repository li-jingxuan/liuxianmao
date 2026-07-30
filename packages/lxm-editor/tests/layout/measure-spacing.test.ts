import { describe, expect, it } from "vitest";

import type { ILXMMeasure } from "../../src/core/types";
import {
  layoutMeasureSpacing,
  summarizeMeasureSpacingWidth,
} from "../../src/layout/measure-spacing";
import { LXM_MEASURE_PADDING_X } from "../../src/layout/layout-constants";

const createBeat = (
  id: string,
  tick: number,
  base: ILXMMeasure["beats"][number]["rhythm"]["base"],
): ILXMMeasure["beats"][number] => ({
  id,
  tick,
  rhythm: { base, dots: 0 },
  kind: "notes",
  notes: [{ id: `${id}-note`, string: 3, fret: 2 }],
});

const createMeasure = (beats: ILXMMeasure["beats"]): ILXMMeasure => ({
  id: "measure-spacing-test",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats,
});

describe("summarizeMeasureSpacingWidth", () => {
  it("按节拍时值计算小节最小宽度和理想宽度", () => {
    const summary = summarizeMeasureSpacingWidth(
      createMeasure([
        createBeat("beat-quarter", 0, "quarter"),
        createBeat("beat-sixteenth", 960, "sixteenth"),
      ]),
    );

    expect(summary.measureId).toBe("measure-spacing-test");
    expect(summary.minWidth).toBe(34 + 17 + LXM_MEASURE_PADDING_X * 2);
    expect(summary.idealWidth).toBeCloseTo(
      34 * 2.2 + 17 + LXM_MEASURE_PADDING_X * 2,
    );
    expect(summary.assignedWidth).toBeCloseTo(summary.idealWidth);
    expect(summary.contentWidth).toBeCloseTo(
      summary.assignedWidth - LXM_MEASURE_PADDING_X * 2,
    );
  });
});

describe("layoutMeasureSpacing", () => {
  it("按 tick 排序生成 beat slot 的 x 和 width", () => {
    const spacing = layoutMeasureSpacing(
      createMeasure([
        createBeat("beat-late", 960, "sixteenth"),
        createBeat("beat-first", 0, "quarter"),
      ]),
      { x: 100 },
    );

    expect(spacing.columns.map((column) => column.tick)).toEqual([0, 960]);
    expect(spacing.slotsByBeatId["beat-first"]).toEqual(
      expect.objectContaining({
        x: 100 + LXM_MEASURE_PADDING_X,
        width: 34 * 2.2,
        columnIndex: 0,
      }),
    );
    expect(spacing.slotsByBeatId["beat-late"]).toEqual(
      expect.objectContaining({
        x: 100 + LXM_MEASURE_PADDING_X + 34 * 2.2,
        width: 17,
        columnIndex: 1,
      }),
    );
  });

  it("保持首尾 padding 不变，并按固有列宽比例分配额外空间", () => {
    const measure = createMeasure([
      createBeat("beat-quarter", 0, "quarter"),
      createBeat("beat-sixteenth", 960, "sixteenth"),
    ]);
    const intrinsic = summarizeMeasureSpacingWidth(measure);
    const assignedWidth = intrinsic.assignedWidth + intrinsic.contentWidth;
    const spacing = layoutMeasureSpacing(measure, { x: 100, assignedWidth });

    expect(spacing.assignedWidth).toBeCloseTo(assignedWidth);
    expect(spacing.slotsByBeatId["beat-quarter"]!.x).toBe(
      100 + LXM_MEASURE_PADDING_X,
    );
    expect(spacing.slotsByBeatId["beat-quarter"]!.width).toBeCloseTo(
      34 * 2.2 * 2,
    );
    expect(spacing.slotsByBeatId["beat-sixteenth"]!.width).toBeCloseTo(17 * 2);

    const lastSlot = spacing.slotsByBeatId["beat-sixteenth"]!;
    expect(lastSlot.x + lastSlot.width).toBeCloseTo(
      100 + assignedWidth - LXM_MEASURE_PADDING_X,
    );
  });

  it("拒绝小于固有宽度或非有限值的 assignedWidth", () => {
    const measure = createMeasure([createBeat("beat-quarter", 0, "quarter")]);
    const intrinsic = summarizeMeasureSpacingWidth(measure).assignedWidth;

    expect(() =>
      layoutMeasureSpacing(measure, {
        x: 0,
        assignedWidth: intrinsic - 1,
      }),
    ).toThrow(/assignedWidth/);
    expect(() =>
      layoutMeasureSpacing(measure, {
        x: 0,
        assignedWidth: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/assignedWidth/);
  });
});
