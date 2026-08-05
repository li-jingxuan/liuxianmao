import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import { getBeatCellBounds } from "../../src/layout/beat-cell-bounds";
import { buildLayout } from "../../src/layout";

describe("getBeatCellBounds", () => {
  it("使用相邻 Beat 锚点的中点划分中间单元格", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const measure = layout.systems[0]!.measures[0]!;
    const previous = measure.beats[0]!;
    const current = measure.beats[1]!;
    const next = measure.beats[2]!;
    const left = (previous.x + current.x) / 2;
    const right = (current.x + next.x) / 2;

    expect(getBeatCellBounds(measure, current.id)).toEqual({
      left,
      right,
      // width 的正式契约是 right - left；不要用代数等价式替代，否则不同的
      // 浮点运算结合顺序可能产生 1e-14 级差异，形成没有业务价值的失败。
      width: right - left,
    });
  });

  it("首尾 Beat 分别使用小节左右边界，避免命中盲区", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const measure = layout.systems[0]!.measures[0]!;
    const first = measure.beats[0]!;
    const second = measure.beats[1]!;
    const previous = measure.beats.at(-2)!;
    const last = measure.beats.at(-1)!;

    expect(getBeatCellBounds(measure, first.id)).toMatchObject({
      left: measure.x,
      right: (first.x + second.x) / 2,
    });
    expect(getBeatCellBounds(measure, last.id)).toMatchObject({
      left: (previous.x + last.x) / 2,
      right: measure.x + measure.width,
    });
  });

  it("只有一个 Beat 时使用完整小节宽度", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const source = layout.systems[0]!.measures[0]!;
    const onlyBeat = source.beats[0]!;
    const measure = { ...source, beats: [onlyBeat] };

    expect(getBeatCellBounds(measure, onlyBeat.id)).toEqual({
      left: measure.x,
      right: measure.x + measure.width,
      width: measure.width,
    });
  });

  it("不依赖 Beat 数组顺序，目标不存在时返回 null", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const source = layout.systems[0]!.measures[0]!;
    const target = source.beats[1]!;
    const expected = getBeatCellBounds(source, target.id);
    const reversed = { ...source, beats: [...source.beats].reverse() };

    expect(getBeatCellBounds(reversed, target.id)).toEqual(expected);
    expect(getBeatCellBounds(source, "missing-beat")).toBeNull();
  });
});
