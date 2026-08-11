import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { loadDocument } from "../../src/core/loader";
import { buildLayout } from "../../src/layout";
import {
  LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE,
  LXM_SYSTEM_HEADER_WIDTH,
  LXM_TIME_SIGNATURE_WIDTH,
} from "../../src/layout/layout-constants";
import { summarizeMeasureSpacingWidth } from "../../src/layout/measure-spacing";

/** 供断行测试复用的固定逻辑宽度；每行应容纳两个标准四分小节。 */
const TWO_MEASURES_PER_SYSTEM_WIDTH = 700;
/** A4 纸张扣除左右各 8mm padding 后的紧凑谱面逻辑宽度。 */
const A4_COMPACT_SYSTEM_WIDTH = 733;

/**
 * 从规范谱例选取指定小节构造最小文档。
 *
 * 测试只改变 track 的 measures 列表，保留真实节奏数据和 schema，避免用手写宽度
 * 替身绕过 measure-spacing。索引为从 0 开始的 fixture 小节位置。
 */
const documentWithMeasures = (measureIndexes: number[]) => ({
  ...EXAMPLE_MVP_2,
  score: {
    ...EXAMPLE_MVP_2.score,
    tracks: [
      {
        ...EXAMPLE_MVP_2.score.tracks[0]!,
        measures: measureIndexes.map(
          (measureIndex) =>
            EXAMPLE_MVP_2.score.tracks[0]!.measures[measureIndex]!,
        ),
      },
    ],
  },
});

/** 按方案公式独立计算一条受限 System 的最大可读宽度。 */
const sparseSystemMaxReadableWidth = (
  measureIndexes: number[],
  measureGap = 0,
) => {
  const summaries = measureIndexes.map((measureIndex) =>
    summarizeMeasureSpacingWidth(
      EXAMPLE_MVP_2.score.tracks[0]!.measures[measureIndex]!,
      "compact",
      // 规范谱例只有整首第一小节展示 4/4；普通换行不会重复相同拍号。
      measureIndex === 0 ? LXM_TIME_SIGNATURE_WIDTH : 0,
    ),
  );
  const totalIntrinsicWidth = summaries.reduce(
    (total, summary) => total + summary.assignedWidth,
    measureGap * Math.max(0, summaries.length - 1),
  );
  const totalContentWidth = summaries.reduce(
    (total, summary) => total + summary.contentWidth,
    0,
  );
  const fixedWidth = totalIntrinsicWidth - totalContentWidth;

  return (
    LXM_SYSTEM_HEADER_WIDTH +
    fixedWidth +
    totalContentWidth * LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE
  );
};

describe("buildLayout 的 system 自动换行", () => {
  it("每条 system 在六线谱内生成纵向 TAB 行头，且所有 measure 从统一 staffX 开始", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: TWO_MEASURES_PER_SYSTEM_WIDTH,
    });

    for (const system of layout.systems) {
      expect(system.header.tabLetters.map((letter) => letter.text)).toEqual([
        "T",
        "A",
        "B",
      ]);
      expect(
        new Set(system.header.tabLetters.map((letter) => letter.x)).size,
      ).toBe(1);
      expect(system.header.tabLetters.map((letter) => letter.y)).toEqual(
        [...system.header.tabLetters.map((letter) => letter.y)].sort(
          (left, right) => left - right,
        ),
      );
      const firstStringY = system.header.strings[0]!.y1;
      const lastStringY = system.header.strings.at(-1)!.y1;
      for (const letter of system.header.tabLetters) {
        expect(letter.y).toBeGreaterThan(firstStringY);
        expect(letter.y).toBeLessThan(lastStringY);
      }
      expect(system.header.width).toBe(LXM_SYSTEM_HEADER_WIDTH);
      expect(system.header.staffX).toBe(system.x + LXM_SYSTEM_HEADER_WIDTH);
      expect(system.measures[0]!.x).toBe(system.header.staffX);
      expect(system.header.strings).toHaveLength(6);
      for (const string of system.header.strings) {
        expect(string.x1).toBe(system.x);
        expect(string.x2).toBe(system.header.staffX);
      }
    }
  });

  it("拍号只在整首第一小节和真实变化点显示", () => {
    const document = documentWithMeasures([0, 1, 2, 3]);
    const measures = document.score.tracks[0]!.measures;
    measures[2] = {
      ...measures[2]!,
      timeSignature: { numerator: 3, denominator: 4 },
    };
    measures[3] = {
      ...measures[3]!,
      timeSignature: { numerator: 3, denominator: 4 },
    };
    const layout = buildLayout(document, { systemWidth: 400 });
    const byId = new Map(
      layout.systems.flatMap((system) =>
        system.measures.map((measure) => [measure.id, measure] as const),
      ),
    );

    expect(byId.get(measures[0]!.id)!.timeSignature).toMatchObject({
      numerator: { text: "4" },
      denominator: { text: "4" },
    });
    expect(byId.get(measures[1]!.id)!.timeSignature).toBeNull();
    expect(byId.get(measures[2]!.id)!.timeSignature).toMatchObject({
      numerator: { text: "3" },
      denominator: { text: "4" },
    });
    expect(byId.get(measures[3]!.id)!.timeSignature).toBeNull();
  });

  it("跨 system 的双向反复线拆成行尾结束反复和下一行开始反复", () => {
    const document = documentWithMeasures([0, 1]);
    document.score.tracks[0]!.measures[0] = {
      ...document.score.tracks[0]!.measures[0]!,
      barline: "repeatBoth",
    };
    const layout = buildLayout(document, { systemWidth: 250 });

    expect(layout.systems).toHaveLength(2);
    expect(layout.systems[0]!.measures[0]!.barline.type).toBe("repeatEnd");
    expect(layout.systems[1]!.header.leadingBarline?.type).toBe("repeatStart");
    // layout 投影不能反向改写领域文档。
    expect(document.score.tracks[0]!.measures[0]!.barline).toBe("repeatBoth");
  });

  it("谱首反复为圆点和首次拍号预留净空，并按新增宽度重新断行", () => {
    const document = structuredClone(EXAMPLE_MVP_2);
    document.score.tracks[0]!.startBarline = "repeatStart";
    const layout = buildLayout(document, {
      systemWidth: A4_COMPACT_SYSTEM_WIDTH,
      density: "compact",
    });
    const firstSystem = layout.systems[0]!;
    const firstMeasure = firstSystem.measures[0]!;
    const repeatDots = firstSystem.header.leadingBarline!.parts.filter(
      (part) => part.kind === "dot",
    );

    expect(
      layout.systems.reduce(
        (count, system) => count + system.measures.length,
        0,
      ),
    ).toBe(8);
    expect(firstMeasure.timeSignature).not.toBeNull();
    expect(
      repeatDots.every(
        (dot) =>
          dot.kind === "dot" &&
          dot.cx + dot.radius < firstMeasure.timeSignature!.numerator.x,
      ),
    ).toBe(true);
  });

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

  it("内容足够密集时，包括末行在内的 System 仍拉伸到目标宽度", () => {
    const systemWidth = 1380;
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth });

    expect(layout.systems).toHaveLength(2);
    expect(layout.systems.map((system) => system.measures.length)).toEqual([
      4, 4,
    ]);
    for (const system of layout.systems) {
      const lastMeasure = system.measures.at(-1)!;
      expect(system.width).toBe(systemWidth);
      expect(lastMeasure.x + lastMeasure.width).toBeCloseTo(
        system.x + systemWidth,
      );
    }
  });

  it("包含两个短小节的末行按整行内容限制拉伸", () => {
    const measureIndexes = [0, 1];
    const systemWidth = A4_COMPACT_SYSTEM_WIDTH;
    const measureGap = 12;
    const layout = buildLayout(documentWithMeasures(measureIndexes), {
      systemWidth,
      density: "compact",
      measureGap,
    });
    const system = layout.systems[0]!;
    const expectedWidth = sparseSystemMaxReadableWidth(
      measureIndexes,
      measureGap,
    );

    expect(system.measures).toHaveLength(2);
    expect(expectedWidth).toBeLessThan(systemWidth);
    expect(system.width).toBeCloseTo(expectedWidth);
    expect(
      system.measures.at(-1)!.x + system.measures.at(-1)!.width,
    ).toBeCloseTo(system.x + expectedWidth);
    expect(
      system.measures[1]!.x -
        (system.measures[0]!.x + system.measures[0]!.width),
    ).toBeCloseTo(measureGap);
  });

  it("非末行的多小节 System 继续铺满目标宽度", () => {
    const systemWidth = TWO_MEASURES_PER_SYSTEM_WIDTH;
    const layout = buildLayout(documentWithMeasures([0, 1, 2]), {
      systemWidth,
    });
    const firstSystem = layout.systems[0]!;

    expect(firstSystem.measures).toHaveLength(2);
    expect(firstSystem.width).toBe(systemWidth);
    expect(
      firstSystem.measures.at(-1)!.x + firstSystem.measures.at(-1)!.width,
    ).toBeCloseTo(firstSystem.x + systemWidth);
  });

  it("非末行的单小节 System 同样限制拉伸", () => {
    const measureIndexes = [0, 1];
    // v4.1 行头和首次拍号也属于整行固定宽度。330 仍放不下两个小节，但大于
    // 首小节的最大可读宽度，因此能同时验证换行与单小节留白限制。
    const systemWidth = 330;
    const layout = buildLayout(documentWithMeasures(measureIndexes), {
      systemWidth,
      density: "compact",
    });
    const firstSystem = layout.systems[0]!;
    const expectedWidth = sparseSystemMaxReadableWidth([measureIndexes[0]!]);

    expect(layout.systems).toHaveLength(2);
    expect(firstSystem.measures).toHaveLength(1);
    expect(expectedWidth).toBeLessThan(systemWidth);
    expect(firstSystem.width).toBeCloseTo(expectedWidth);
  });

  it("稀疏末行缩短时仍保留完整画布宽度", () => {
    const systemWidth = A4_COMPACT_SYSTEM_WIDTH;
    const layout = buildLayout(documentWithMeasures([0, 1]), {
      systemWidth,
      density: "compact",
    });

    expect(layout.systems[0]!.width).toBeLessThan(systemWidth);
    expect(layout.width).toBe(systemWidth);
  });

  it("紧凑排版让 A4 规范谱例优先按每行四小节断行", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: A4_COMPACT_SYSTEM_WIDTH,
      density: "compact",
    });

    expect(layout.systems).toHaveLength(2);
    expect(layout.systems.map((system) => system.measures.length)).toEqual([
      4, 4,
    ]);
    for (const system of layout.systems) {
      expect(system.width).toBe(A4_COMPACT_SYSTEM_WIDTH);
      expect(system.measures.at(-1)!.x + system.measures.at(-1)!.width).toBe(
        A4_COMPACT_SYSTEM_WIDTH,
      );
    }
  });

  it("紧凑排版不会把复杂小节压缩到固有宽度以下", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: 200,
      density: "compact",
    });

    expect(layout.systems.every((system) => system.measures.length === 1)).toBe(
      true,
    );
    expect(layout.systems[2]!.width).toBeGreaterThan(200);
    expect(
      layout.systems[2]!.measures[0]!.beats.every((beat) => beat.width >= 15),
    ).toBe(true);
  });

  it("measureGap 不参与内容拉伸，最终右边界仍与目标宽度一致", () => {
    const systemWidth = 1380;
    const measureGap = 12;
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth, measureGap });

    for (const system of layout.systems) {
      const lastMeasure = system.measures.at(-1)!;
      expect(lastMeasure.x + lastMeasure.width).toBeCloseTo(
        system.x + systemWidth,
      );
      system.measures.slice(1).forEach((measure, index) => {
        const previous = system.measures[index]!;
        expect(measure.x - (previous.x + previous.width)).toBeCloseTo(
          measureGap,
        );
      });
    }
  });

  it("拒绝无法生成有限布局的 systemWidth 和 measureGap", () => {
    expect(() =>
      buildLayout(EXAMPLE_MVP_2, { systemWidth: Number.POSITIVE_INFINITY }),
    ).toThrow(/systemWidth/);
    expect(() => buildLayout(EXAMPLE_MVP_2, { systemWidth: 0 })).toThrow(
      /systemWidth/,
    );
    expect(() => buildLayout(EXAMPLE_MVP_2, { measureGap: -1 })).toThrow(
      /measureGap/,
    );
  });

  it("小节高度完整容纳固定 rhythm lane 和底部留白", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth: 1380 });
    const durationLaneFits = layout.systems.every((system) =>
      system.measures.every((measure) =>
        measure.durationMarks.every(
          (mark) =>
            // Bravura down flag 在当前字号下从字形原点向下延伸约 36px。
            (mark.flag ? mark.flag.y + 36 : mark.stemY2) <=
            measure.y + measure.height - 12,
        ),
      ),
    );

    expect(durationLaneFits).toBe(true);
  });
});
