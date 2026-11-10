import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { buildLayout, hitTestLayout } from "../../src/layout";
import { getBeatCellBounds } from "../../src/layout/beat-cell-bounds";

const documentWithFirstMeasureOnly = {
  ...EXAMPLE_MVP_2,
  score: {
    ...EXAMPLE_MVP_2.score,
    tracks: [
      {
        ...EXAMPLE_MVP_2.score.tracks[0]!,
        measures: [EXAMPLE_MVP_2.score.tracks[0]!.measures[0]!],
      },
    ],
  },
};

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

  it("拉伸后点击最后一个 beat 到小节右边界之间仍命中最后一拍", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth: 1380 });
    const measure = layout.systems[0]!.measures[0]!;
    const lastBeat = measure.beats.at(-1)!;
    const string = measure.strings[2]!;

    expect(
      hitTestLayout(layout, {
        x: measure.x + measure.width - 1,
        y: string.y1,
      }),
    ).toMatchObject({
      measureId: measure.id,
      beatId: lastBeat.id,
      string: string.index,
    });
  });

  it("紧凑 A4 排版仍能命中第二行的目标 beat 与弦", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: 733,
      density: "compact",
    });
    const measure = layout.systems[1]!.measures[0]!;
    const beat = measure.beats[1]!;
    const string = measure.strings[4]!;

    expect(hitTestLayout(layout, { x: beat.x + 1, y: string.y1 })).toEqual({
      trackId: "mvp2-track-guitar",
      systemIndex: 1,
      measureId: measure.id,
      beatId: beat.id,
      string: 5,
    });
  });

  it("选框单元格的水平中心命中同一个 beat", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth: 733 });
    const measure = layout.systems[0]!.measures[0]!;
    const beat = measure.beats[1]!;
    const bounds = getBeatCellBounds(measure, beat.id)!;
    const string = measure.strings[3]!;

    expect(
      hitTestLayout(layout, {
        x: bounds.left + bounds.width / 2,
        y: string.y1,
      }),
    ).toMatchObject({
      measureId: measure.id,
      beatId: beat.id,
      string: string.index,
    });
  });

  it("受控拉伸后小节内仍命中最后一拍，画布右侧留白不命中", () => {
    const systemWidth = 733;
    const layout = buildLayout(documentWithFirstMeasureOnly, {
      systemWidth,
      density: "compact",
    });
    const system = layout.systems[0]!;
    const measure = system.measures[0]!;
    const string = measure.strings[2]!;

    expect(layout.width).toBe(systemWidth);
    expect(system.width).toBeLessThan(systemWidth);
    const measureRight = measure.x + measure.width;
    expect(measureRight).toBeCloseTo(system.x + system.width);
    expect(measure.barline.parts).toContainEqual(expect.objectContaining({
      kind: "line",
      x: measureRight,
    }));
    expect(layout.hitIndex.measureBounds[0]!.width).toBe(measure.width);
    expect(
      hitTestLayout(layout, {
        x: measureRight - 1,
        y: string.y1,
      }),
    ).toMatchObject({
      measureId: measure.id,
      beatId: measure.beats.at(-1)!.id,
      string: string.index,
    });
    for (const x of [
      measureRight + 1,
      (measureRight + system.x + systemWidth) / 2,
      system.x + systemWidth - 1,
      system.x + systemWidth + 1,
    ]) {
      expect(hitTestLayout(layout, { x, y: string.y1 })).toBeNull();
    }
  });
});
