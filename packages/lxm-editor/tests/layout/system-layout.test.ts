import { describe, expect, it } from "vitest";
import { getDurationFlagBottom } from "../../src/layout/rhythm-bounds";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { loadDocument } from "../../src/core/loader";
import { buildLayout } from "../../src/layout";
import {
  LXM_LAYOUT_DENSITY_PROFILES,
  LXM_SYSTEM_HEADER_WIDTH,
  LXM_TIME_SIGNATURE_WIDTH,
} from "../../src/layout/layout-constants";
import { summarizeMeasureSpacingWidth } from "../../src/layout/measure-spacing";
import type { ILXMLayoutDensity } from "../../src/layout/layout-types";
import { shouldShowTimeSignature } from "../../src/layout/time-signature-layout";
import EXAMPLE_MVP_7_2_DOCUMENT from "../../example/example-mvp7.2";

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

/** 使用实际节奏摘要核对内容比例，固定拍号不计入可拉伸宽度。 */
const intrinsicSpacing = (
  document: ReturnType<typeof documentWithMeasures>,
  density: ILXMLayoutDensity,
) => {
  const measures = document.score.tracks[0]!.measures;
  return measures.map((measure, index) =>
    summarizeMeasureSpacingWidth(
      measure,
      density,
      shouldShowTimeSignature(measures, index) ? LXM_TIME_SIGNATURE_WIDTH : 0,
    ),
  );
};

describe("buildLayout 的 system 自动换行", () => {
  it.each(["editing", "presentation"] as const)(
    "%s 混合谱按实际行宽收束，删除技巧后重排仍保持几何一致",
    (purpose) => {
      const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
      const options = {
        purpose,
        density: "compact" as const,
        systemWidth: A4_COMPACT_SYSTEM_WIDTH,
        x: 17,
        y: 23,
        showChordDiagrams: true,
      };
      for (const withLetRing of [true, false]) {
        if (!withLetRing)
          document.score.tracks[0]!.techniques = document.score.tracks[0]!.techniques
            .filter((item) => item.type !== "letRing");
        const before = structuredClone(document);
        const layout = buildLayout(document, options);
        expect(layout.systems.length).toBeGreaterThan(1);
        expect(
          layout.systems.flatMap((system) => system.measures.map((measure) => measure.id)),
        ).toEqual(document.score.tracks[0]!.measures.map((measure) => measure.id));
        for (const system of layout.systems) {
          expect(system.x).toBe(options.x);
          expect(system.width).toBeLessThanOrEqual(options.systemWidth);
          if (
            system.index < layout.systems.length - 1 &&
            system.measures.length > 1
          )
            expect(system.width).toBeCloseTo(options.systemWidth);
          const last = system.measures.at(-1)!;
          expect(last.x + last.width).toBeCloseTo(system.x + system.width);
          for (const measure of system.measures) {
            for (const string of measure.strings) {
              expect(string.x1).toBeCloseTo(measure.x);
              expect(string.x2).toBeCloseTo(measure.x + measure.width);
            }
            for (const beat of measure.beats) {
              expect(beat.x).toBeGreaterThanOrEqual(measure.x);
              expect(beat.x).toBeLessThan(measure.x + measure.width);
            }
          }
        }
        expect(document).toEqual(before);
      }
    },
  );
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
    const summaries = intrinsicSpacing(EXAMPLE_MVP_2, "comfortable");

    expect(layout.systems).toHaveLength(8);
    expect(layout.systems.every((system) => system.measures.length === 1)).toBe(
      true,
    );
    expect(layout.systems[0]!.width).toBeGreaterThan(100);
    layout.systems.forEach((system, index) => {
      const measure = system.measures[0]!;
      expect(measure.width).toBeCloseTo(summaries[index]!.assignedWidth);
      measure.beats.forEach((beat, beatIndex) => {
        expect(beat.width).toBeCloseTo(
          summaries[index]!.columns[beatIndex]!.idealWidth,
        );
      });
      expect(system.width).toBeCloseTo(LXM_SYSTEM_HEADER_WIDTH + measure.width);
    });
    expect(layout.width).toBe(
      Math.max(...layout.systems.map((system) => system.width)),
    );
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

  it("包含两个不同密度小节的末行按内容比例封顶，固定拍号、padding 和间隔不变", () => {
    const measureIndexes = [0, 1];
    const systemWidth = A4_COMPACT_SYSTEM_WIDTH;
    const measureGap = 12;
    const document = documentWithMeasures(measureIndexes);
    const summaries = intrinsicSpacing(document, "compact");
    const layout = buildLayout(document, {
      systemWidth,
      density: "compact",
      measureGap,
      x: 17,
    });
    const system = layout.systems[0]!;
    expect(system.measures).toHaveLength(2);
    expect(summaries[0]!.contentWidth).not.toBe(summaries[1]!.contentWidth);
    const fixedWidth =
      LXM_SYSTEM_HEADER_WIDTH + LXM_TIME_SIGNATURE_WIDTH +
      4 * LXM_LAYOUT_DENSITY_PROFILES.compact.measurePaddingX + measureGap +
      summaries.reduce((sum, summary) => sum + summary.leftExtra + summary.tailExtra, 0);
    expect(system.width).toBeCloseTo(
      fixedWidth + summaries.reduce(
        (sum, summary) => sum + summary.contentWidth * 1.6,
        0,
      ),
    );
    expect(system.width).toBeLessThan(systemWidth);
    expect(
      system.measures.at(-1)!.x + system.measures.at(-1)!.width,
    ).toBeCloseTo(system.x + system.width);
    system.measures.forEach((measure, index) => {
      expect(measure.width - summaries[index]!.assignedWidth).toBeCloseTo(
        summaries[index]!.contentWidth * 0.6,
      );
    });
    expect(
      system.measures[1]!.x -
        (system.measures[0]!.x + system.measures[0]!.width),
    ).toBeCloseTo(measureGap);
  });

  it("非末行的多小节 System 继续铺满目标宽度", () => {
    const systemWidth = TWO_MEASURES_PER_SYSTEM_WIDTH;
    const document = documentWithMeasures([0, 1, 2]);
    const summaries = intrinsicSpacing(document, "comfortable");
    const layout = buildLayout(document, {
      systemWidth,
    });
    const firstSystem = layout.systems[0]!;

    expect(firstSystem.measures).toHaveLength(2);
    expect(firstSystem.width).toBe(systemWidth);
    expect(
      firstSystem.measures.at(-1)!.x + firstSystem.measures.at(-1)!.width,
    ).toBeCloseTo(firstSystem.x + systemWidth);
    const contentScales = firstSystem.measures.map(
      (measure, index) =>
        (measure.width - summaries[index]!.assignedWidth) /
        summaries[index]!.contentWidth,
    );
    expect(contentScales[0]).toBeCloseTo(contentScales[1]!);
  });

  it("放不下下一小节时，非末行的单小节同样限制内容拉伸", () => {
    const measureIndexes = [0, 1];
    // 行宽低于两小节硬宽之和，压缩到硬边界仍无法合行。
    const document = documentWithMeasures(measureIndexes);
    const summaries = intrinsicSpacing(document, "compact");
    const systemWidth = LXM_SYSTEM_HEADER_WIDTH + summaries.reduce(
      (sum, summary) => sum + summary.minWidth, 0,
    ) - 1;
    const layout = buildLayout(document, {
      systemWidth,
      density: "compact",
    });
    const firstSystem = layout.systems[0]!;

    expect(layout.systems).toHaveLength(2);
    expect(firstSystem.measures).toHaveLength(1);
    expect(firstSystem.width).toBeLessThanOrEqual(systemWidth);
    for (const [index, system] of layout.systems.entries()) {
      const summary = summaries[index]!;
      expect(system.width).toBeCloseTo(
        Math.min(
          systemWidth,
          LXM_SYSTEM_HEADER_WIDTH + summary.assignedWidth + summary.contentWidth * 0.6,
        ),
      );
      const last = system.measures.at(-1)!;
      expect(last.x + last.width).toBeCloseTo(system.x + system.width);
    }
  });

  it.each(["comfortable", "compact"] as const)(
    "%s 不同时值密度的单小节内容最多展开至 1.6 倍，画布保留目标宽度",
    (density) => {
      for (const measureIndex of [0, 1, 2]) {
        const document = documentWithMeasures([measureIndex]);
        const summary = intrinsicSpacing(document, density)[0]!;
        const padding = LXM_LAYOUT_DENSITY_PROFILES[density].measurePaddingX;
        const layout = buildLayout(document, { systemWidth: 2000, density, x: 17 });
        const system = layout.systems[0]!;
        const measure = system.measures[0]!;
        expect(layout.width).toBe(2000);
        expect(system.width).toBeLessThan(layout.width);
        expect(system.width).toBeCloseTo(
          LXM_SYSTEM_HEADER_WIDTH + 2 * padding + LXM_TIME_SIGNATURE_WIDTH +
            summary.contentWidth * 1.6,
        );
        expect(measure.beats[0]!.x - measure.x).toBeCloseTo(
          padding + LXM_TIME_SIGNATURE_WIDTH,
        );
        measure.beats.forEach((beat, index) => {
          expect(beat.width).toBeCloseTo(summary.columns[index]!.idealWidth * 1.6);
        });
        const lastBeat = measure.beats.at(-1)!;
        expect(measure.x + measure.width - lastBeat.x - lastBeat.width).toBeCloseTo(
          padding,
        );

        // 固有宽恰好达到行宽，或只需小幅展开即可填满时，均保留完整边界。
        const intrinsicSystemWidth = LXM_SYSTEM_HEADER_WIDTH + summary.assignedWidth;
        for (const systemWidth of [
          intrinsicSystemWidth,
          intrinsicSystemWidth + summary.contentWidth * 0.3,
        ]) {
          const dense = buildLayout(document, { systemWidth, density });
          const denseSystem = dense.systems[0]!;
          expect(denseSystem.width).toBeCloseTo(systemWidth);
          expect(denseSystem.measures[0]!.width).toBeGreaterThanOrEqual(
            summary.assignedWidth,
          );
        }
      }
    },
  );

  it.each(["comfortable", "compact"] as const)(
    "%s 编辑、预览/导出与默认 purpose 的 TAB 谱行几何一致",
    (density) => {
      for (const indexes of [[0], [0, 1], [0, 1, 2], [0, 1, 2, 3, 4, 5, 6, 7]]) {
        const document = documentWithMeasures(indexes);
        const options = { systemWidth: A4_COMPACT_SYSTEM_WIDTH, density };
        const presentation = buildLayout(document, {
          ...options,
          purpose: "presentation",
        });
        expect(buildLayout(document, { ...options, purpose: "editing" })).toEqual(
          presentation,
        );
        expect(buildLayout(document, options)).toEqual(presentation);
      }
    },
  );

  it("紧凑排版让 A4 规范谱例按五小节和三小节断行", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: A4_COMPACT_SYSTEM_WIDTH,
      density: "compact",
    });

    expect(layout.systems).toHaveLength(2);
    expect(layout.systems.map((system) => system.measures.length)).toEqual([
      5, 3,
    ]);
    expect(layout.systems[0]!.width).toBe(A4_COMPACT_SYSTEM_WIDTH);
    const finalSummaries = intrinsicSpacing(EXAMPLE_MVP_2, "compact").slice(5);
    expect(layout.systems[1]!.width).toBeCloseTo(
      LXM_SYSTEM_HEADER_WIDTH + finalSummaries.reduce(
        (sum, summary) => sum + summary.assignedWidth + summary.contentWidth * 0.6,
        0,
      ),
    );
    expect(layout.systems[1]!.width).toBeLessThan(A4_COMPACT_SYSTEM_WIDTH);
    for (const system of layout.systems) {
      expect(system.measures.at(-1)!.x + system.measures.at(-1)!.width).toBeCloseTo(
        system.x + system.width,
      );
    }
  });

  it("紧凑排版允许低于理想宽，但复杂小节仍不低于硬宽", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, {
      systemWidth: 200,
      density: "compact",
    });

    const summaries = intrinsicSpacing(EXAMPLE_MVP_2, "compact");
    const measures = layout.systems.flatMap((system) => system.measures);
    expect(measures.map((measure) => measure.id)).toEqual(
      EXAMPLE_MVP_2.score.tracks[0]!.measures.map((measure) => measure.id),
    );
    measures.forEach((measure, index) => {
      expect(measure.width).toBeGreaterThanOrEqual(summaries[index]!.minWidth - 1e-8);
      expect(measure.beats.every((beat) => beat.width >= 9 - 1e-8)).toBe(true);
    });
    expect(measures.some((measure, index) =>
      measure.width < summaries[index]!.idealWidth - 1e-8,
    )).toBe(true);
    for (const system of layout.systems) {
      if (system.width <= 200) continue;
      expect(system.measures).toHaveLength(1);
      const measure = system.measures[0]!;
      const summary = summaries.find((item) => item.measureId === measure.id)!;
      expect(summary.minWidth + LXM_SYSTEM_HEADER_WIDTH).toBeGreaterThan(200);
    }
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

  it("小节高度完整容纳实际节奏图形和底部留白", () => {
    const layout = buildLayout(EXAMPLE_MVP_2, { systemWidth: 1380 });
    const durationLaneFits = layout.systems.every((system) =>
      system.measures.every((measure) =>
        measure.durationMarks.every(
          (mark) =>
            (mark.flag ? getDurationFlagBottom(mark.flag) : mark.stemY2) <=
            measure.y + measure.height - 12,
        ),
      ),
    );

    expect(durationLaneFits).toBe(true);
  });
});
