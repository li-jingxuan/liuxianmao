import { describe, expect, it } from "vitest";

import type { ILXMMeasure } from "../../src/core/types";
import {
  layoutMeasureSpacing,
  summarizeMeasureSpacingWidth,
} from "../../src/layout/structure/measure-spacing";
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
  numberedVoice: { events: [], tuplets: [] },
  tuplets: [],
  lyrics: [],
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

  it("紧凑排版保留 9 的起音硬宽，理想宽按 .22 缩放，空白时间延伸至小节末尾", () => {
    const summary = summarizeMeasureSpacingWidth(
      createMeasure([
        createBeat("beat-quarter", 0, "quarter"),
        createBeat("beat-sixteenth", 960, "sixteenth"),
      ]),
      "compact",
    );

    expect(summary.columns.map((column) => [column.tick, column.endTick])).toEqual([
      [0, 960], [960, 1200], [1200, 3840],
    ]);
    expect(summary.columns.map((column) => column.minWidth)).toEqual([9, 9, 1]);
    expect(summary.columns.map((column) => column.idealWidth)).toEqual([
      34 * 2.2 * 0.22,
      9,
      1,
    ]);
    // 数字半宽 3，左侧净空 6；扣除固定 padding 3 后还需 6。
    expect(summary.leftExtra).toBe(6);
    expect(summary.hardLeftExtra).toBe(6);
    expect(summary.tailExtra).toBe(0);
    expect(summary.hardTailExtra).toBe(0);
    expect(summary.minWidth).toBe(9 + 9 + 1 + 3 * 2 + 6);
    expect(summary.idealWidth).toBeCloseTo(34 * 2.2 * 0.22 + 9 + 1 + 3 * 2 + 6);
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

  it("紧凑排版保持 3px padding，末拍与其后的空白时间共同延伸至右边界", () => {
    const measure = createMeasure([
      createBeat("beat-quarter", 0, "quarter"),
      createBeat("beat-sixteenth", 960, "sixteenth"),
    ]);
    const intrinsic = summarizeMeasureSpacingWidth(measure, "compact");
    const assignedWidth = intrinsic.assignedWidth + 40;
    const spacing = layoutMeasureSpacing(measure, {
      x: 100,
      density: "compact",
      assignedWidth,
    });

    expect(spacing.slotsByBeatId["beat-quarter"]!.x).toBe(100 + 3 + intrinsic.leftExtra);
    const lastSlot = spacing.slotsByBeatId["beat-sixteenth"]!;
    expect(lastSlot.width).toBeGreaterThanOrEqual(9);
    expect(lastSlot.x + lastSlot.width).toBeCloseTo(spacing.xByTick[1200]!);
    expect(spacing.xByTick[3840]!).toBeCloseTo(100 + assignedWidth - 3);
    expect(spacing.xByTick[3840]! - spacing.xByTick[1200]!).toBeGreaterThan(0);
  });

  it("compact 在硬宽与理想宽之间插值完整时间点位置，低于硬宽才拒绝", () => {
    const measure = createMeasure([
      createBeat("beat-quarter", 0, "quarter"),
      createBeat("beat-sixteenth", 960, "sixteenth"),
    ]);
    const summary = summarizeMeasureSpacingWidth(measure, "compact");
    const layoutAt = (assignedWidth: number) => layoutMeasureSpacing(measure, {
      x: 100,
      density: "compact",
      assignedWidth,
    });
    const hard = layoutAt(summary.minWidth);
    const ideal = layoutAt(summary.idealWidth);
    const middle = layoutAt((summary.minWidth + summary.idealWidth) / 2);
    expect(hard.xByTick).toEqual({ 0: 109, 960: 118, 1200: 127, 3840: 128 });
    for (const tick of [0, 960, 1200, 3840])
      expect(middle.xByTick[tick]).toBeCloseTo(
        (hard.xByTick[tick]! + ideal.xByTick[tick]!) / 2,
      );
    for (const spacing of [hard, middle, ideal]) {
      expect(spacing.slotsByBeatId["beat-quarter"]!.x).toBe(spacing.xByTick[0]);
      expect(spacing.slotsByBeatId["beat-quarter"]!.width).toBeCloseTo(
        spacing.xByTick[960]! - spacing.xByTick[0]!,
      );
      expect(spacing.xByTick[3840]! + 3 + spacing.tailExtra).toBeCloseTo(
        100 + spacing.assignedWidth,
      );
    }
    expect(() => layoutAt(summary.minWidth - 0.01)).toThrow(/assignedWidth/);
    expect(() => layoutAt(Number.POSITIVE_INFINITY)).toThrow(/assignedWidth/);
  });
});
