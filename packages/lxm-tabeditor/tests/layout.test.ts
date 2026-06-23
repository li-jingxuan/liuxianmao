import { describe, expect, it } from "vitest";
import { hitTestScoreLayout, layoutScore } from "../src/layout/score-layout";
import { createExampleDocument } from "../src/testing/example-document";

interface TestDurationMark {
  beatId: string;
  base: string;
  dots: number;
  flagCount: number;
}

interface TestBeamSegment {
  kind: "shared" | "partial";
  level: number;
  beatIds?: string[];
  beatId?: string;
  direction?: "left" | "right";
}

interface TestMeasureWithDuration {
  durationMarks?: TestDurationMark[];
  beamSegments?: TestBeamSegment[];
}

describe("六线谱只读排版", () => {
  it("从示例 score 生成全部小节、音符、休止符与命中索引", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const track = document.score.tracks[0]!;
    const noteCount = track.measures.reduce(
      (total, measure) =>
        total +
        measure.beats.reduce(
          (measureTotal, beat) =>
            measureTotal + (beat.kind === "notes" ? beat.notes.length : 0),
          0,
        ),
      0,
    );

    expect(layout.systems.flatMap((system) => system.measures)).toHaveLength(
      track.measures.length,
    );
    expect(Object.keys(layout.hitIndex.measures)).toHaveLength(
      track.measures.length,
    );
    expect(Object.keys(layout.hitIndex.notes)).toHaveLength(noteCount);
    expect(
      layout.systems.flatMap((system) =>
        system.measures.flatMap((measure) => measure.rests),
      ),
    ).toHaveLength(1);
  });

  it("使用固定 720p 桌面基线宽度和每行 4 小节排版", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);

    expect(layout.width).toBe(1040);
    expect(layout.systems).toHaveLength(1);
    expect(layout.systems[0]?.measures).toHaveLength(4);
  });

  it("渲染变拍号、休止符和三连音括号的布局信息", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const measures = layout.systems.flatMap((system) => system.measures);

    expect(measures[0]?.showTimeSignature).toBe(true);
    expect(measures[2]?.timeSignature).toEqual({
      numerator: 3,
      denominator: 4,
    });
    expect(measures[2]?.showTimeSignature).toBe(true);
    expect(measures.flatMap((measure) => measure.rests)[0]?.symbol).toBe(
      "\uE4E6",
    );
    expect(measures[3]?.tuplets[0]).toMatchObject({
      id: "tuplet-004-01",
      number: 3,
      bracket: "show",
    });
  });

  it("为音符拍输出时值标记、附点和基础连梁片段", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const measures = layout.systems.flatMap((system) => system.measures);
    const firstMeasure = measures[0]! as typeof measures[number] &
      TestMeasureWithDuration;
    const fourthMeasure = measures[3]! as typeof measures[number] &
      TestMeasureWithDuration;

    expect(firstMeasure.durationMarks).toBeDefined();
    expect(fourthMeasure.durationMarks).toBeDefined();
    expect(fourthMeasure.beamSegments).toBeDefined();

    expect(firstMeasure.durationMarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          beatId: "beat-001-03",
          base: "quarter",
          dots: 0,
          flagCount: 0,
        }),
        expect.objectContaining({
          beatId: "beat-001-07",
          base: "sixteenth",
          dots: 0,
          flagCount: 2,
        }),
      ]),
    );

    const secondMeasure = measures[1]! as typeof measures[number] &
      TestMeasureWithDuration;
    expect(secondMeasure.durationMarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          beatId: "beat-002-01",
          base: "quarter",
          dots: 1,
          flagCount: 0,
        }),
        expect.objectContaining({
          beatId: "beat-002-03",
          base: "eighth",
          dots: 1,
          flagCount: 1,
        }),
      ]),
    );

    expect(fourthMeasure.durationMarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          beatId: "beat-004-04",
          base: "quarter",
          dots: 1,
          flagCount: 0,
        }),
        expect.objectContaining({
          beatId: "beat-004-05",
          base: "eighth",
          dots: 0,
          flagCount: 1,
        }),
      ]),
    );

    expect(fourthMeasure.beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: ["beat-004-01", "beat-004-02", "beat-004-03"],
        }),
      ]),
    );
  });

  it("为附点八分加十六分组合输出 shared 和 partial 两类 beam segment", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const measures = layout.systems.flatMap((system) => system.measures);
    const secondMeasure = measures[1]! as typeof measures[number] &
      TestMeasureWithDuration;
    const firstMeasure = measures[0]! as typeof measures[number] &
      TestMeasureWithDuration;

    expect(secondMeasure.beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: ["beat-002-02", "beat-002-03", "beat-002-04"],
        }),
        expect.objectContaining({
          kind: "partial",
          beatId: "beat-002-04",
          level: 2,
          direction: "left",
        }),
      ]),
    );

    expect(firstMeasure.beamSegments ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "partial",
          beatId: "beat-001-07",
        }),
      ]),
    );
  });

  it("能把 SVG 坐标命中到最近拍点和弦线", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const measure = layout.systems[0]!.measures[0]!;
    const beat = measure.beats[0]!;
    const hit = hitTestScoreLayout(layout, {
      x: beat.x + 4,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toEqual({
      measureId: measure.id,
      beatId: beat.id,
      tick: beat.tick,
      string: 3,
    });
  });

  it("100 小节只读谱例保持线性布局输出", () => {
    const document = createExampleDocument();
    const track = document.score.tracks[0]!;
    track.measures = Array.from({ length: 100 }, (_, index) => ({
      ...track.measures[index % track.measures.length]!,
      id: `measure-copy-${index + 1}`,
    }));

    const layout = layoutScore(document.score);

    expect(layout.systems).toHaveLength(25);
    expect(layout.systems.flatMap((system) => system.measures)).toHaveLength(
      100,
    );
    expect(layout.height).toBeGreaterThan(3000);
  });
});
