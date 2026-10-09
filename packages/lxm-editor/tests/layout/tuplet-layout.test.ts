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
const measures = example.score.tracks[0]!.measures;

describe("连音布局的最终几何", () => {
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
