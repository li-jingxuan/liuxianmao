import { describe, expect, it } from "vitest";
import { createEmptyScore } from "../src/core/score-factory";
import { hitTestScoreLayout, layoutScore } from "../src/layout/score-layout";
import { createExampleDocument } from "../src/testing/example-document";

interface TestDurationMark {
  beatId: string;
  base: string;
  dots: number;
  flagCount: number;
  flagAnchors?: Array<{
    level: 1 | 2 | 3;
    x: number;
    y: number;
  }>;
  dot?: {
    x: number;
    y: number;
  };
}

interface TestBeamSegment {
  kind: "shared" | "partial";
  level: number;
  beatIds?: string[];
  beatId?: string;
  direction?: "left" | "right";
}

interface TestTieSegment {
  id: string;
  systemIndex: number;
  role: "single" | "start" | "middle" | "end";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TestTie {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  fromMeasureId: string;
  toMeasureId: string;
  segments: TestTieSegment[];
}

interface TestMeasureWithDuration {
  durationMarks?: TestDurationMark[];
  beamSegments?: TestBeamSegment[];
}

interface TestBeatSpacingSlot {
  beatId: string;
  tick: number;
  x: number;
  width: number;
  columnIndex: number;
}

interface TestRhythmicColumn {
  tick: number;
  beatIds: string[];
  durationWeight: number;
  minWidth: number;
  idealWidth: number;
}

interface TestMeasureSpacingSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
  assignedWidth: number;
  columns: TestRhythmicColumn[];
  slotsByBeatId: Record<string, TestBeatSpacingSlot>;
}

interface TestMeasureWithSpacing {
  spacing?: TestMeasureSpacingSummary;
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
    const layout = layoutScore(document.score, { measuresPerSystem: 4 });

    expect(layout.width).toBe(1040);
    expect(layout.systems).toHaveLength(2);
    expect(layout.systems[0]?.measures).toHaveLength(4);
    expect(layout.systems[1]?.measures).toHaveLength(4);
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

  it("4/4 小节的八分层连梁会在拍边界处断开，而不是跨拍连成一段", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0]!.beats = [
      { id: "beat-001-01", tick: 0, rhythm: { base: "quarter", dots: 0 }, kind: "rest" },
      { id: "beat-001-02", tick: 960, rhythm: { base: "quarter", dots: 0 }, kind: "rest" },
      {
        id: "beat-001-03",
        tick: 1920,
        rhythm: { base: "thirtySecond", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-03-01", string: 2, fret: 1, techniques: [] }],
      },
      {
        id: "beat-001-04",
        tick: 2040,
        rhythm: { base: "thirtySecond", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-04-01", string: 1, fret: 3, techniques: [] }],
      },
      {
        id: "beat-001-05",
        tick: 2160,
        rhythm: { base: "thirtySecond", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-05-01", string: 2, fret: 0, techniques: [] }],
      },
      {
        id: "beat-001-06",
        tick: 2280,
        rhythm: { base: "thirtySecond", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-06-01", string: 5, fret: 3, techniques: [] }],
      },
      {
        id: "beat-001-07",
        tick: 2400,
        rhythm: { base: "eighth", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-07-01", string: 4, fret: 0, techniques: [] }],
      },
      {
        id: "beat-001-08",
        tick: 2880,
        rhythm: { base: "eighth", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-08-01", string: 3, fret: 2, techniques: [] }],
      },
      {
        id: "beat-001-09",
        tick: 3360,
        rhythm: { base: "sixteenth", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-09-01", string: 2, fret: 3, techniques: [] }],
      },
      {
        id: "beat-001-10",
        tick: 3600,
        rhythm: { base: "sixteenth", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-001-10-01", string: 1, fret: 1, techniques: [] }],
      },
    ];

    const layout = layoutScore(score);
    const measure = layout.systems[0]!.measures[0]! as typeof layout.systems[number]["measures"][number] &
      TestMeasureWithDuration;

    expect(measure.beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: [
            "beat-001-03",
            "beat-001-04",
            "beat-001-05",
            "beat-001-06",
            "beat-001-07",
          ],
        }),
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: ["beat-001-08", "beat-001-09", "beat-001-10"],
        }),
      ]),
    );

    expect(measure.beamSegments ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: [
            "beat-001-03",
            "beat-001-04",
            "beat-001-05",
            "beat-001-06",
            "beat-001-07",
            "beat-001-08",
            "beat-001-09",
            "beat-001-10",
          ],
        }),
      ]),
    );
  });

  it("为每个小节输出节奏列和 beat spacing slot", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const firstMeasure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithSpacing;

    expect(firstMeasure.spacing).toBeDefined();
    expect(firstMeasure.spacing?.measureId).toBe("measure-001");
    expect(firstMeasure.spacing?.columns.length).toBeGreaterThan(0);
    expect(firstMeasure.spacing?.slotsByBeatId["beat-001-01"]).toEqual(
      expect.objectContaining({
        beatId: "beat-001-01",
        tick: 0,
        columnIndex: 0,
      }),
    );
  });

  it("三十二分音符也保留可读的最小视觉列宽", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const measures = layout.systems.flatMap((system) => system.measures) as Array<
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithSpacing
    >;
    const measureWithThirtySecond = measures.find((measure) =>
      measure.spacing?.columns.some((column) =>
        column.beatIds.some((beatId) =>
          measure.durationMarks.some(
            (mark) => mark.beatId === beatId && mark.base === "thirtySecond",
          ),
        ),
      ),
    );
    const thirtySecondColumn = measureWithThirtySecond?.spacing?.columns.find(
      (column) =>
        column.beatIds.some((beatId) =>
          measureWithThirtySecond.durationMarks.some(
            (mark) => mark.beatId === beatId && mark.base === "thirtySecond",
          ),
        ),
    );

    expect(thirtySecondColumn).toEqual(
      expect.objectContaining({
        minWidth: 12,
      }),
    );
  });

  it("同一行内小节可根据内容获得不同宽度", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score, { measuresPerSystem: 4 });
    const firstSystemWidths = layout.systems[0]!.measures.map(
      (measure) => measure.width,
    );
    const uniqueWidths = new Set(
      firstSystemWidths.map((width) => Math.round(width)),
    );

    expect(uniqueWidths.size).toBeGreaterThan(1);
  });

  it("内容理想宽度未占满整行时保留行尾空白而不拉伸小节", () => {
    const document = createExampleDocument();
    const track = document.score.tracks[0]!;
    track.measures = [track.measures[0]!];
    const layout = layoutScore(document.score);
    const firstSystemMeasures = layout.systems[0]!.measures;
    const assignedWidth = firstSystemMeasures.reduce(
      (total, measure) => total + measure.width,
      0,
    );
    const idealWidth = firstSystemMeasures.reduce(
      (total, measure) => total + measure.spacing.idealWidth,
      0,
    );

    expect(assignedWidth).toBe(idealWidth);
    expect(assignedWidth).toBeLessThan(layout.width - 88);
  });

  it("自动分行按小节内容宽度累加，超过行宽才换行", () => {
    const document = createExampleDocument();
    const track = document.score.tracks[0]!;
    const denseMeasure = track.measures[6]!;
    track.measures = Array.from({ length: 8 }, (_, measureIndex) => ({
      ...denseMeasure,
      id: `auto-break-measure-${measureIndex + 1}`,
      beats: denseMeasure.beats.map((beat, beatIndex) => ({
        ...beat,
        id: `auto-break-beat-${measureIndex + 1}-${beatIndex + 1}`,
        ...(beat.kind === "notes"
          ? {
              notes: beat.notes.map((note, noteIndex) => ({
                ...note,
                id: `auto-break-note-${measureIndex + 1}-${beatIndex + 1}-${noteIndex + 1}`,
              })),
            }
          : {}),
      })),
    }));

    const layout = layoutScore(document.score);
    const firstSystemWidth = layout.systems[0]!.measures.reduce(
      (total, measure) => total + measure.width,
      0,
    );

    expect(layout.systems.length).toBeGreaterThan(1);
    expect(firstSystemWidth).toBeLessThanOrEqual(layout.width - 88);
  });

  it("音符、时值标记和命中区共享同一 beat spacing x 坐标", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score, { measuresPerSystem: 4 });
    const firstMeasure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithSpacing;
    const slot = firstMeasure.spacing!.slotsByBeatId["beat-001-01"]!;
    const note = firstMeasure.notes.find(
      (item) => item.beatId === "beat-001-01",
    )!;
    const durationMark = firstMeasure.durationMarks.find(
      (item) => item.beatId === "beat-001-01",
    )!;
    const hitBounds = layout.hitIndex.beats["beat-001-01"]!;

    expect(note.x).toBe(slot.x);
    expect(durationMark.x).toBe(slot.x);
    expect(hitBounds.x).toBeLessThanOrEqual(slot.x);
    expect(hitBounds.x + hitBounds.width).toBeGreaterThan(slot.x);
  });

  it("尾部 gap 中的 slot x 坐标按 tick 单调递增且留在小节内", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-tail-gap",
          tick: 0,
          rhythm: { base: "half", dots: 0 },
          kind: "rest",
        },
      ],
    };

    const layout = layoutScore(score, {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]!;
    const gapSlots =
      measure.editGrid?.slots.filter((slot) => slot.kind === "gap") ?? [];

    expect(gapSlots.map((slot) => slot.tick)).toEqual([1920, 2880]);
    expect(gapSlots[0]!.x).toBeLessThan(gapSlots[1]!.x);
    expect(gapSlots[1]!.x + gapSlots[1]!.width).toBeLessThanOrEqual(
      measure.x + measure.width,
    );
  });

  it("三十二分音符输出统一层距的符尾锚点和独立附点坐标", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score);
    const measures = layout.systems.flatMap((system) => system.measures);
    const measuresWithDuration = measures as Array<
      typeof measures[number] & TestMeasureWithDuration
    >;
    const thirtySecondMark = measuresWithDuration
      .flatMap((measure) => measure.durationMarks ?? [])
      .find((mark) => mark.base === "thirtySecond");

    expect(thirtySecondMark).toBeDefined();
    expect(thirtySecondMark?.flagCount).toBe(3);
    expect(thirtySecondMark?.flagAnchors).toEqual([
      expect.objectContaining({ level: 1 }),
      expect.objectContaining({ level: 2 }),
      expect.objectContaining({ level: 3 }),
    ]);

    const flagAnchors = thirtySecondMark?.flagAnchors ?? [];
    expect(flagAnchors[1]!.y - flagAnchors[0]!.y).toBe(-6);
    expect(flagAnchors[2]!.y - flagAnchors[1]!.y).toBe(-6);
    expect(thirtySecondMark?.dot?.y).not.toBe(flagAnchors[1]!.y);
  });

  it("为跨小节延音输出逻辑 tie 和单段 segment", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score, {
      measuresPerSystem: 4,
    }) as typeof layoutScore extends (...args: never[]) => infer T
      ? T & { ties?: TestTie[] }
      : never;

    expect(layout.ties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromNoteId: "note-003-03-01",
          toNoteId: "note-004-01-01",
          fromMeasureId: "measure-003",
          toMeasureId: "measure-004",
          segments: [
            expect.objectContaining({
              role: "single",
            }),
          ],
        }),
      ]),
    );
  });

  it("同一行 tie 的单段 segment 右端点必须位于目标音方向", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score, {
      measuresPerSystem: 4,
    }) as typeof layoutScore extends (...args: never[]) => infer T
      ? T & { ties?: TestTie[] }
      : never;

    const tie = layout.ties?.find(
      (item) => item.fromNoteId === "note-003-03-01",
    );
    const segment = tie?.segments[0];

    expect(tie).toBeDefined();
    expect(segment).toBeDefined();
    expect(segment!.role).toBe("single");
    expect(segment!.x2).toBeGreaterThan(segment!.x1);
    expect(segment!.y2).toBe(segment!.y1);
  });

  it("跨行 tie 会按 system 边界拆成 start 和 end 两段", () => {
    const document = createExampleDocument();
    const layout = layoutScore(document.score, {
      measuresPerSystem: 3,
    }) as typeof layoutScore extends (...args: never[]) => infer T
      ? T & { ties?: TestTie[] }
      : never;

    const tie = layout.ties?.find(
      (item) => item.fromNoteId === "note-003-03-01",
    );

    expect(tie?.segments).toEqual([
      expect.objectContaining({
        systemIndex: 0,
        role: "start",
      }),
      expect.objectContaining({
        systemIndex: 1,
        role: "end",
      }),
    ]);
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

    const layout = layoutScore(document.score, { measuresPerSystem: 4 });

    expect(layout.systems).toHaveLength(25);
    expect(layout.systems.flatMap((system) => system.measures)).toHaveLength(
      100,
    );
    expect(layout.height).toBeGreaterThan(3000);
  });
});
