import { describe, it, expect } from "vitest";
import { buildLayout } from "../../src/layout";
import { buildRhythmicColumns } from "../../src/layout/measure-spacing";
import { layoutMeasure } from "../../src/layout/measure-layout";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as Command,
} from "../../src/core/commands";
import example from "../../example/example-mvp5.1.json";
import v5 from "../../example/example-mvp5.json";
import v6 from "../../example/example-mvp6.json";
import { alignSystemTuplets } from "../../src/layout/tuplet-layout";
const measures = example.score.tracks[0]!.measures;

describe("连音布局的最终几何", () => {
  it.each(["compact", "comfortable"] as const)(
    "%s 同一谱行中符尾、连梁和休止符不再造成括号端点高低不齐",
    (density) => {
      for (const systemWidth of [720, 10000]) {
        const layout = buildLayout(example, { systemWidth, density });
        for (const system of layout.systems) {
          const groups = system.measures.flatMap((measure) => measure.tuplets);
          expect(new Set(groups.map((group) => group.label.y)).size).toBe(1);
          expect(new Set(groups.map((group) => group.bracket!.y)).size).toBe(1);
          for (const group of groups) {
            const [left, right] = group.bracket!.lines.slice(2);
            expect(left!.y1).toBe(right!.y1);
            expect(left!.y2).toBe(right!.y2);
          }
        }
      }
    },
  );
  it("统一标注高度保留水平锚点与净空，且不修改原始小节布局", () => {
    const raw = [measures[0]!, measures[7]!].map((measure, index) =>
      layoutMeasure(measure, {
        index,
        systemIndex: 0,
        x: index * 400,
        y: 30,
        density: "compact",
      }),
    );
    const before = structuredClone(raw);
    expect(raw[0]!.tuplets[0]!.label.y).toBeLessThan(
      raw[1]!.tuplets[0]!.label.y,
    );
    const aligned = alignSystemTuplets(raw);
    expect(raw).toEqual(before);
    aligned.forEach((measure, index) => {
      const group = measure.tuplets[0]!;
      const old = before[index]!.tuplets[0]!;
      expect(group.label.y).toBe(before[1]!.tuplets[0]!.label.y);
      expect(group.label.x).toBe(old.label.x);
      expect(group.bracket!.x1).toBe(old.bracket!.x1);
      expect(group.bracket!.x2).toBe(old.bracket!.x2);
      expect(group.bracket!.gapX1).toBe(old.bracket!.gapX1);
      expect(group.bracket!.gapX2).toBe(old.bracket!.gapX2);
      expect(group.label.y - group.bracket!.y).toBeCloseTo(
        old.label.y - old.bracket!.y,
      );
      expect(group.label.y + 12).toBeLessThanOrEqual(
        measure.y + measure.height,
      );
    });
  });
  it("含歌词与技巧的最终谱行仍对齐括号，并为歌词和下一行保留净空", () => {
    const layout = buildLayout(v6, { systemWidth: 720, density: "compact" });
    layout.systems.forEach((system, index) => {
      const groups = system.measures.flatMap((measure) => measure.tuplets);
      expect(new Set(groups.map((group) => group.bracket!.y)).size).toBe(1);
      const annotationBottom = Math.max(
        ...groups.map((group) => group.label.y + 12),
      );
      system.measures.forEach((measure) => {
        measure.lyrics!.forEach((lyric) =>
          expect(lyric.bounds.y).toBeGreaterThan(annotationBottom),
        );
        measure.durationMarks.forEach((mark) => {
          if (mark.flag && measure.tuplets.length)
            expect(measure.tuplets[0]!.bracket!.lines[2]!.y2).toBeGreaterThan(
              mark.flag.y + 36,
            );
        });
      });
      if (index > 0)
        expect(system.y).toBeGreaterThanOrEqual(
          layout.systems[index - 1]!.y + layout.systems[index - 1]!.height,
        );
    });
  });
  it.each(["compact", "comfortable"] as const)(
    "%s 六种比例实际 ticks 与书写视觉权重",
    (density) => {
      const durations = [320, 720, 180, 192, 144, 160, 480, 320];
      measures.forEach((measure, index) => {
        const columns = buildRhythmicColumns(measure, density);
        expect(columns[0]!.rhythmTicks).toBe(durations[index]);
        const ordinary = buildRhythmicColumns(
          { ...measure, tuplets: [] },
          density,
        );
        expect(columns[0]!.durationWeight).toBe(ordinary[0]!.durationWeight);
      });
    },
  );
  it("有无完整连梁均显示数字和范围括号", () => {
    const layout = buildLayout(example, {
      systemWidth: 720,
      density: "compact",
    });
    expect(layout.systems.length).toBeGreaterThanOrEqual(2);
    const layouts = layout.systems.flatMap((system) => system.measures);
    layouts.forEach((measure) =>
      expect(measure.tuplets[0]!.bracket?.lines).toHaveLength(4),
    );
    expect(layouts[7]!.tuplets[0]!.bracket?.lines).toHaveLength(4);
    expect(layouts[3]!.tuplets[0]!.label.text).toBe("5");
    expect(layouts[4]!.tuplets[0]!.label.text).toBe("5");
    expect(layouts[3]!.tuplets[0]!.ratio).not.toEqual(
      layouts[4]!.tuplets[0]!.ratio,
    );
  });
  it("括号标签与端点是首末 Beat 锚点，中央 gap 包围数字", () => {
    const measure = layoutMeasure(measures[7]!, {
      index: 7,
      systemIndex: 0,
      x: 20,
      y: 30,
      density: "compact",
    });
    const group = measure.tuplets[0]!,
      bracket = group.bracket!;
    expect(bracket.x1).toBe(measure.beats[0]!.x);
    expect(bracket.x2).toBe(measure.beats[2]!.x);
    expect(group.label.x).toBe((bracket.x1 + bracket.x2) / 2);
    expect(bracket.gapX1).toBeLessThan(group.label.x);
    expect(bracket.gapX2).toBeGreaterThan(group.label.x);
    expect(bracket.lines.slice(2).every((line) => line.y2 < line.y1)).toBe(
      true,
    );
  });
  it("旗帜、附点、休止符下方净空与动态 system 高度", () => {
    const doc = structuredClone(example);
    doc.score.tracks[0]!.measures[0]!.beats[1]!.kind = "rest";
    doc.score.tracks[0]!.measures[0]!.beats[1]!.notes = [];
    const layout = buildLayout(doc, { systemWidth: 500, density: "compact" });
    layout.systems.forEach((system, index) => {
      system.measures.forEach((measure) =>
        measure.tuplets.forEach((group) => {
          expect(group.label.y + 12).toBeLessThanOrEqual(
            measure.y + measure.height + 1e-9,
          );
          measure.durationMarks.forEach((mark) => {
            expect(group.label.y - group.label.fontSize).toBeGreaterThan(
              mark.flag ? mark.flag.y + 36 : mark.stemY2,
            );
          });
        }),
      );
      if (index > 0)
        expect(system.y).toBeGreaterThanOrEqual(
          layout.systems[index - 1]!.y + layout.systems[index - 1]!.height,
        );
    });
    expect(layout.height).toBeGreaterThan(
      layout.systems.at(-1)!.y + layout.systems.at(-1)!.height - layout.y - 1,
    );
  });
  it("连音 beam seam 不吸入组外短音，也不按普通拍组截断组内音", () => {
    const measure = structuredClone(measures[1]!);
    // 二连音跨越四分拍边界，一级连梁仍完整覆盖两成员。
    const result = layoutMeasure(measure, {
      index: 0,
      systemIndex: 0,
      x: 0,
      y: 0,
      density: "compact",
    });
    expect(
      result.beamSegments.some(
        (segment) =>
          segment.level === 1 &&
          segment.beatIds.join(",") === measure.tuplets[0]!.beatIds.join(","),
      ),
    ).toBe(true);
    const doc = structuredClone(example),
      trackId = doc.score.tracks[0]!.id;
    const last = doc.score.tracks[0]!.measures[0]!.beats[3]!;
    last.kind = "notes";
    last.notes = [{ id: "outside", string: 1, fret: 5 }];
    last.rhythm = { base: "eighth", dots: 0 };
    // 核心时值协调把已有 rest 改为孤立短音；seam 不跨组。
    const reconciled = applyScoreCommand(example, {
      type: Command.SetNote,
      trackId,
      measureId: measures[0]!.id,
      beatId: measures[0]!.beats[3]!.id,
      string: 1,
      fret: 5,
    });
    expect(reconciled.ok).toBe(true);
    const seam = layoutMeasure(doc.score.tracks[0]!.measures[0]!, {
      index: 0,
      systemIndex: 0,
      x: 0,
      y: 0,
      density: "compact",
    });
    expect(
      seam.beamSegments
        .filter((segment) => segment.level === 1)
        .every((segment) => !segment.beatIds.includes(last.id)),
    ).toBe(true);
  });
  it("无组 v5 几何保持，输入不可变；重排不改领域数据", () => {
    const before = structuredClone(v5),
      a = buildLayout(v5, { density: "compact" }),
      b = buildLayout(v5, { density: "compact" });
    expect(a).toEqual(b);
    expect(v5).toEqual(before);
    expect(
      a.systems.flatMap((s) => s.measures).every((m) => m.tuplets.length === 0),
    ).toBe(true);
    const source = structuredClone(example);
    const wide = buildLayout(example, { systemWidth: 900 }),
      narrow = buildLayout(example, { systemWidth: 450 });
    expect(example).toEqual(source);
    expect(narrow.systems.length).toBeGreaterThanOrEqual(wide.systems.length);
    expect(narrow).toEqual(buildLayout(example, { systemWidth: 450 }));
  });
});
