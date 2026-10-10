import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp5.1.json";
import type { ILXMRhythmBase } from "../../src/core/types";
import { layoutMeasure } from "../../src/layout/measure-layout";
import { buildLayout, EXAMPLE_MVP_6_DOCUMENT } from "../../src";
import { getDurationFlagTop } from "../../src/layout/rhythm-bounds";
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
      // 四分符干距第六弦 22，加底部 padding 后只需 122 个布局单位。
      expect(quarter.height).toBe(122);
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
  it("三层连梁按最上层净空扩展，同一行的四分音符沿公共基线且不移动音符锚点", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    track.techniques = [];
    track.measures = track.measures.slice(0, 2);
    for (const measure of track.measures) {
      measure.tuplets = [];
      measure.lyrics = [];
      measure.chordSymbols = [];
    }
    track.measures[0]!.beats = [track.measures[0]!.beats[0]!];
    track.measures[0]!.beats[0]!.rhythm = { base: "quarter", dots: 0 };
    const first = structuredClone(track.measures[1]!.beats[0]!);
    first.tick = 0;
    first.kind = "notes";
    first.notes = [{ id: "lane-note-1", string: 6, fret: 2 }];
    first.rhythm = { base: "thirtySecond", dots: 1 };
    const second = structuredClone(first);
    second.id = "lane-beat-2";
    second.tick = 180;
    second.notes[0]!.id = "lane-note-2";
    track.measures[1]!.beats = [first, second];
    const measures = buildLayout(document, { systemWidth: 1800 }).systems[0]!
      .measures;
    const baseline = measures[1]!.durationMarks[0]!.beamY;
    expect(baseline - measures[1]!.strings[5]!.y1).toBe(25.5);
    for (const measure of measures) {
      for (const mark of measure.durationMarks) {
        expect(mark.beamY).toBe(baseline);
        const note = measure.notes
          .filter((n) => n.beatId === mark.beatId)
          .sort((a, b) => b.y - a.y)[0]!;
        expect(mark.stemY1).toBe(note.y + 6);
        for (const dot of mark.dotAnchors)
          expect(dot.y - 2 - measure.strings[5]!.y1).toBeGreaterThanOrEqual(8);
      }
      for (const beam of measure.beamSegments)
        expect(
          beam.y - beam.thickness / 2 - measure.strings[5]!.y1,
        ).toBeGreaterThanOrEqual(14);
    }
  });
  it.each(["eighth", "sixteenth", "thirtySecond"] as const)(
    "孤立 %s 符尾上缘至少离第六弦 6，附点至少离弦 8",
    (base) => {
      const source = isolatedMeasure(base);
      source.beats[0]!.rhythm.dots = 1;
      const measure = layoutMeasure(source, {
        index: 0,
        systemIndex: 0,
        x: 20,
        y: 100,
        density: "compact",
      });
      const mark = measure.durationMarks[0]!;
      const sixthY = measure.strings[5]!.y1;
      expect(getDurationFlagTop(mark.flag!) - sixthY).toBeGreaterThanOrEqual(6);
      expect(mark.dotAnchors[0]!.y - 2 - sixthY).toBeGreaterThanOrEqual(8);
    },
  );
});
