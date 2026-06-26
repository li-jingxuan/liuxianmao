import { describe, expect, it } from "vitest";
import { hitTestScoreLayout, layoutScore } from "../src/layout/score-layout";
import { createEmptyScore } from "../src/core/score-factory";
import type { LaidOutBeatEditGridSlot } from "../src/layout/layout-types";

interface TestEditGridSlot {
  id: string;
  kind: "beat" | "gap";
  beatId?: string;
  coveringBeatId?: string;
  tick: number;
  x: number;
  width: number;
  gapStartTick?: number;
  gapEndTick?: number;
}

interface TestMeasureWithEditGrid {
  editGrid?: {
    slots: TestEditGridSlot[];
  };
}

describe("占位编辑网格", () => {
  const createLongBeatScore = () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-long-01",
          tick: 960,
          rhythm: { base: "quarter", dots: 0 },
          kind: "notes",
          notes: [{ id: "note-long-01", string: 2, fret: 3, techniques: [] }],
        },
      ],
    };
    return score;
  };

  it("按当前编辑时值在长 beat 内部生成占位 slot", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "thirtySecond", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const beatSlots =
      measure.editGrid?.slots.filter(
        (slot): slot is LaidOutBeatEditGridSlot =>
          slot.kind === "beat" && slot.coveringBeatId === "beat-long-01",
      ) ?? [];

    expect(beatSlots).toHaveLength(8);
    expect(beatSlots.filter((slot) => slot.beatId === undefined)).toHaveLength(7);
  });

  it("命中长 beat 内部空槽时返回 slotId 和 slot tick", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "thirtySecond", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const secondSlot = measure.editGrid?.slots.filter(
      (slot): slot is LaidOutBeatEditGridSlot =>
        slot.kind === "beat" && slot.coveringBeatId === "beat-long-01",
    )[1];
    expect(secondSlot).toBeDefined();
    if (!secondSlot || secondSlot.kind !== "beat") return;

    const hit = hitTestScoreLayout(layout, {
      x: secondSlot.x + secondSlot.width / 2,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      measureId: "measure-001",
      beatId: "beat-long-01",
      tick: secondSlot.tick,
      slotId: secondSlot.id,
    });
  });

  it("4/4 小节未写满时，会为尾部 gap 生成可点击 slot", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-gap-01",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "notes",
          notes: [{ id: "note-gap-01", string: 2, fret: 3, techniques: [] }],
        },
      ],
    };

    const layout = layoutScore(score, {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const gapSlots = measure.editGrid?.slots.filter((slot) => slot.kind === "gap");

    expect(gapSlots).toHaveLength(3);
    expect(gapSlots?.map((slot) => slot.tick)).toEqual([960, 1920, 2880]);
    expect(gapSlots?.every((slot) => slot.gapStartTick === 960)).toBe(true);
    expect(gapSlots?.every((slot) => slot.gapEndTick === 3840)).toBe(true);
  });

  it("小节中间存在时间空洞时，会为中间 gap 生成 slot", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-gap-left",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "rest",
        },
        {
          id: "beat-gap-right",
          tick: 1920,
          rhythm: { base: "quarter", dots: 0 },
          kind: "rest",
        },
      ],
    };

    const layout = layoutScore(score, {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;

    expect(
      measure.editGrid?.slots.find(
        (slot) =>
          slot.kind === "gap" &&
          slot.tick === 960 &&
          slot.gapStartTick === 960 &&
          slot.gapEndTick === 1920,
      ),
    ).toBeDefined();
  });

  it("前导 gap 会生成独立宽度，而不是退化为 1px", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const leadingGapSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "gap" && slot.tick === 0,
    );
    const firstBeatSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "beat" && slot.tick === 960,
    );

    expect(leadingGapSlot).toBeDefined();
    expect(firstBeatSlot).toBeDefined();
    expect(leadingGapSlot?.width).toBeGreaterThan(1);
    expect(leadingGapSlot?.x).toBeLessThan(firstBeatSlot!.x);
    expect(leadingGapSlot!.x + leadingGapSlot!.width).toBe(firstBeatSlot!.x);
  });

  it("命中 gap slot 时返回 slotKind 和 gap 范围，而不是最近 beat", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-gap-01",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "rest",
        },
      ],
    };

    const layout = layoutScore(score, {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const gapSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "gap" && slot.tick === 960,
    );
    expect(gapSlot).toBeDefined();
    if (!gapSlot) return;

    const hit = hitTestScoreLayout(layout, {
      x: gapSlot.x + gapSlot.width / 2,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      measureId: "measure-001",
      tick: 960,
      slotId: gapSlot.id,
      slotKind: "gap",
      gapStartTick: 960,
      gapEndTick: 3840,
    });
  });

  it("命中前导 gap 内部时返回 gap 语义，而不是首个 beat", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const leadingGapSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "gap" && slot.tick === 0,
    );
    expect(leadingGapSlot).toBeDefined();
    if (!leadingGapSlot) return;

    const hit = hitTestScoreLayout(layout, {
      x: leadingGapSlot.x + leadingGapSlot.width / 2,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      measureId: "measure-001",
      tick: 0,
      slotId: leadingGapSlot.id,
      slotKind: "gap",
      gapStartTick: 0,
      gapEndTick: 960,
    });
  });

  it("命中 beat slot 时仍返回 covering beat 语义", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "thirtySecond", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const beatSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "beat" && slot.beatId,
    );
    expect(beatSlot).toBeDefined();
    if (!beatSlot || beatSlot.kind !== "beat") return;

    const hit = hitTestScoreLayout(layout, {
      x: beatSlot.x + beatSlot.width / 2,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      slotKind: "beat",
      beatId: beatSlot.coveringBeatId,
      tick: beatSlot.tick,
      slotId: beatSlot.id,
    });
  });

  it("前导 gap 与首个 beat 共边界时，边界点归属于 beat", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const firstBeatSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "beat" && slot.tick === 960,
    );
    expect(firstBeatSlot).toBeDefined();
    if (!firstBeatSlot || firstBeatSlot.kind !== "beat") return;

    const hit = hitTestScoreLayout(layout, {
      x: firstBeatSlot.x,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      slotKind: "beat",
      beatId: firstBeatSlot.coveringBeatId,
      tick: 960,
      slotId: firstBeatSlot.id,
    });
  });
});
