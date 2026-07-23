import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { buildLayout, hitTestLayout } from "../../src/layout";

describe("hitTestLayout", () => {
  it("可以命中第二条谱面行中的指定 beat 与弦", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth: 700 });
    const measure = layout.systems[1]!.measures[0]!;
    const beat = measure.beats[1]!;
    const string = measure.strings[4]!;

    expect(hitTestLayout(layout, { x: beat.x + 1, y: string.y1 })).toEqual({
      trackId: "mvp2-track-guitar",
      systemIndex: 1,
      measureId: "mvp2-measure-3",
      beatId: "mvp2-beat-3-2",
      string: 5,
    });
  });

  it("点击谱面行之间的空白区域时不返回编辑目标", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: 700,
      systemGapY: 40,
    });
    const firstSystem = layout.systems[0]!;

    expect(
      hitTestLayout(layout, {
        x: firstSystem.x + 10,
        y: firstSystem.y + firstSystem.height + 20,
      }),
    ).toBeNull();
  });
});
