import { describe, expect, it } from "vitest";

import type { ILXMMeasure } from "../../src/core/types";
import { layoutMeasure } from "../../src/layout/measure-layout";

const createMeasure = (): ILXMMeasure => ({
  id: "rest-layout-measure",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats: [0, 960, 1920, 2880].map((tick, index) => ({
    id: `rest-beat-${index + 1}`,
    tick,
    rhythm: { base: "quarter", dots: 0 },
    kind: "rest",
    notes: [],
  })),
});

const expectRestsAtBeatAnchors = (layout: ReturnType<typeof layoutMeasure>) => {
  expect(layout.restMarks).toHaveLength(layout.beats.length);
  for (const rest of layout.restMarks) {
    const beat = layout.beats.find((item) => item.id === rest.beatId);
    expect(beat).toBeDefined();
    expect(rest.x).toBe(beat!.x);
  }
};

describe("rest layout", () => {
  it("让每个休止符与对应 beat 使用同一横向时间锚点", () => {
    const layout = layoutMeasure(createMeasure(), {
      index: 0,
      systemIndex: 0,
      x: 100,
      y: 20,
      density: "comfortable",
    });

    expectRestsAtBeatAnchors(layout);
  });

  it("在 compact 密度和小节拉伸后仍保持时间锚点对齐", () => {
    const measure = createMeasure();
    const intrinsic = layoutMeasure(measure, {
      index: 0,
      systemIndex: 0,
      x: 100,
      y: 20,
      density: "compact",
    });
    const stretched = layoutMeasure(measure, {
      index: 0,
      systemIndex: 0,
      x: 100,
      y: 20,
      density: "compact",
      assignedWidth: intrinsic.width + 160,
    });

    expectRestsAtBeatAnchors(stretched);
  });
});
