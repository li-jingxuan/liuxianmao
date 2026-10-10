import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp5.1.json";
import type { ILXMRhythmBase } from "../../src/core/types";
import { layoutMeasure } from "../../src/layout/measure-layout";
import { getDurationFlagBottom } from "../../src/layout/rhythm-bounds";

/** 单个有音符的 Beat 强制生成孤立符尾，避免连梁覆盖隐藏回归问题。 */
const isolatedMeasure = (base: ILXMRhythmBase) => {
  const measure = structuredClone(source.score.tracks[0]!.measures[0]!);
  measure.tuplets = [];
  measure.beats = [measure.beats[0]!];
  measure.beats[0]!.rhythm = { base, dots: 0 };
  return measure;
};

describe("节奏轮廓与紧凑行高", () => {
  it.each(["compact", "comfortable"] as const)(
    "%s 三种孤立符尾只增加实际下缘空间，不再增加字体行框高度",
    (density) => {
      const context = { index: 0, systemIndex: 0, x: 20, y: 100, density };
      const quarter = layoutMeasure(isolatedMeasure("quarter"), context);
      for (const base of ["eighth", "sixteenth", "thirtySecond"] as const) {
        const layout = layoutMeasure(isolatedMeasure(base), context);
        const flag = layout.durationMarks[0]!.flag!;
        expect(flag).not.toBeNull();
        expect(layout.height - quarter.height).toBeGreaterThan(0);
        expect(layout.height - quarter.height).toBeLessThan(5);
        expect(layout.y + layout.height).toBeCloseTo(
          getDurationFlagBottom(flag) + 12,
        );
      }
      // 原始固定高度为 174；四分符干只需要 138 个布局单位。
      expect(quarter.height).toBe(138);
    },
  );
  it("符尾下缘随字号缩放，文字基线移动只平移最终边界", () => {
    for (const [glyph, descent] of [
      ["\uE241", 0.252],
      ["\uE243", 0.162],
      ["\uE245", 3.096],
    ] as const) {
      expect(
        getDurationFlagBottom({ glyph, x: 0, y: 200, fontSize: 18 }),
      ).toBeCloseTo(201 + descent);
      expect(
        getDurationFlagBottom({ glyph, x: 0, y: 500, fontSize: 36 }),
      ).toBeCloseTo(501 + descent * 2);
    }
  });
  it("只有休止符时不预留空的符干和符尾带，仍容纳六线谱和选择净空", () => {
    const measure = isolatedMeasure("thirtySecond");
    measure.beats[0]!.kind = "rest";
    measure.beats[0]!.notes = [];
    const layout = layoutMeasure(measure, {
      index: 0,
      systemIndex: 0,
      x: 20,
      y: 100,
      density: "compact",
    });
    expect(layout.durationMarks).toHaveLength(0);
    expect(layout.height).toBe(100);
    expect(layout.y + layout.height).toBeGreaterThanOrEqual(
      layout.restMarks[0]!.y + 18 + 12,
    );
    expect(layout.y + layout.height).toBe(layout.strings[5]!.y1 + 12);
  });
});
