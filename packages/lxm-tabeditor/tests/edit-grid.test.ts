import { describe, expect, it } from "vitest";
import { hitTestScoreLayout, layoutScore } from "../src/layout/score-layout";
import { createExampleDocument } from "../src/testing/example-document";

interface TestEditGridSlot {
  id: string;
  beatId?: string;
  coveringBeatId: string;
  tick: number;
  x: number;
  width: number;
}

interface TestMeasureWithEditGrid {
  editGrid?: {
    slots: TestEditGridSlot[];
  };
}

describe("占位编辑网格", () => {
  it("按当前编辑时值在长 beat 内部生成占位 slot", () => {
    const document = createExampleDocument();
    const options = {
      editingRhythm: { base: "thirtySecond", dots: 0 },
    } as Parameters<typeof layoutScore>[1] & {
      editingRhythm: { base: "thirtySecond"; dots: 0 };
    };
    const layout = layoutScore(document.score, options);
    const measure = layout.systems.flatMap((system) => system.measures)[4]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;

    expect(
      measure.editGrid?.slots.filter(
        (slot) => slot.coveringBeatId === "beat-005-11",
      ),
    ).toHaveLength(8);
    expect(
      measure.editGrid?.slots.filter(
        (slot) =>
          slot.coveringBeatId === "beat-005-11" && slot.beatId === undefined,
      ),
    ).toHaveLength(7);
  });

  it("命中长 beat 内部空槽时返回 slotId 和 slot tick", () => {
    const document = createExampleDocument();
    const options = {
      editingRhythm: { base: "thirtySecond", dots: 0 },
    } as Parameters<typeof layoutScore>[1] & {
      editingRhythm: { base: "thirtySecond"; dots: 0 };
    };
    const layout = layoutScore(document.score, options);
    const measure = layout.systems.flatMap((system) => system.measures)[4]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const secondSlot = measure.editGrid?.slots.filter(
      (slot) => slot.coveringBeatId === "beat-005-11",
    )[1];
    expect(secondSlot).toBeDefined();
    if (!secondSlot) return;

    const hit = hitTestScoreLayout(layout, {
      x: secondSlot.x + secondSlot.width / 2,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      measureId: "measure-005",
      beatId: "beat-005-11",
      tick: secondSlot.tick,
      slotId: secondSlot.id,
    });
  });
});
