import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { loadDocument } from "../../src/core/loader";
import { buildLayout } from "../../src/layout";

/** 供断行测试复用的固定逻辑宽度；每行应容纳两个标准四分小节。 */
const TWO_MEASURES_PER_SYSTEM_WIDTH = 700;

describe("buildLayout 的 system 自动换行", () => {
  it("MVP v2 fixture 可以通过文档加载器校验", () => {
    expect(loadDocument(JSON.stringify(EXAMPLE_MVP_2))).toMatchObject({
      ok: true,
    });
  });

  it("将 8 个小节按稳定顺序断为 4 条谱面行", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: TWO_MEASURES_PER_SYSTEM_WIDTH,
    });

    expect(layout.systems).toHaveLength(4);
    expect(
      layout.systems.map((system) =>
        system.measures.map((measure) => measure.id),
      ),
    ).toEqual([
      ["mvp2-measure-1", "mvp2-measure-2"],
      ["mvp2-measure-3", "mvp2-measure-4"],
      ["mvp2-measure-5", "mvp2-measure-6"],
      ["mvp2-measure-7", "mvp2-measure-8"],
    ]);
  });

  it("下一条谱面行的 y 坐标由前一行高度和行距推导", () => {
    const systemGapY = 40;
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: TWO_MEASURES_PER_SYSTEM_WIDTH,
      systemGapY,
    });
    const [firstSystem, secondSystem] = layout.systems;

    expect(secondSystem!.y).toBe(
      firstSystem!.y + firstSystem!.height + systemGapY,
    );
    expect(
      secondSystem!.measures.every((measure) => measure.systemIndex === 1),
    ).toBe(true);
  });

  it("超宽小节独占一行而不被缩放或丢弃", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth: 100 });

    expect(layout.systems).toHaveLength(8);
    expect(layout.systems.every((system) => system.measures.length === 1)).toBe(
      true,
    );
    expect(layout.systems[0]!.width).toBeGreaterThan(100);
  });
});
