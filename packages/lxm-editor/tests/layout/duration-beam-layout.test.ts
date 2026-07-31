import { describe, expect, it } from "vitest";

import type { ILXMMeasure } from "../../src/core/types";
import {
  LXM_DURATION_DOT_GAP_X,
  LXM_DURATION_DOT_OFFSET_X,
  groupContiguousMarks,
  layoutBeamSegments,
  layoutDurationBeams,
} from "../../src/layout/duration-beam-layout";
import type {
  ILXMBeatLayout,
  ILXMDurationMarkLayout,
  ILXMNoteLayout,
  ILXMStringLineLayout,
} from "../../src/layout/layout-types";

const createBeat = (
  id: string,
  tick: number,
  base: ILXMMeasure["beats"][number]["rhythm"]["base"],
  dots = 0,
): ILXMMeasure["beats"][number] => ({
  id,
  tick,
  rhythm: { base, dots },
  kind: "notes",
  notes: [{ id: `${id}-note`, string: 3, fret: 2 }],
});

const createMeasure = (beats: ILXMMeasure["beats"]): ILXMMeasure => ({
  id: "measure-duration-beam-test",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats,
});

const createMark = (
  beatId: string,
  beamLevel: number,
  stemX = 0,
  beamY = 100,
): ILXMDurationMarkLayout => ({
  beatId,
  measureId: "measure-duration-beam-test",
  head: { glyph: "\uE0A4", x: stemX, y: beamY - 28, fontSize: 16 },
  stemVisible: true,
  stemX,
  stemY1: 0,
  stemY2: 0,
  beamY,
  beamLevel,
  sustainMarks: [],
  flag: null,
  dots: 0,
  dotAnchors: [],
});

const createMarkMap = (
  marks: ILXMDurationMarkLayout[],
): Map<string, ILXMDurationMarkLayout> =>
  new Map(marks.map((mark) => [mark.beatId, mark]));

const getGroupBeatIds = (groups: ILXMDurationMarkLayout[][]): string[][] =>
  groups.map((group) => group.map((mark) => mark.beatId));

const createDurationLayoutInputs = (
  dots: number,
  base: ILXMMeasure["beats"][number]["rhythm"]["base"] = "eighth",
) => {
  const beat = createBeat("beat-dots", 0, base, dots);
  const measure = createMeasure([beat]);
  const beatLayouts: ILXMBeatLayout[] = [
    {
      id: beat.id,
      measureId: measure.id,
      tick: beat.tick,
      x: 40,
      // 长时值至少需要为每个四分单位保留可读宽度；短时值沿用紧凑列宽。
      width: base === "whole" ? 80 : base === "half" ? 40 : 24,
      rhythm: beat.rhythm,
      columnIndex: 0,
    },
  ];
  const noteLayouts: ILXMNoteLayout[] = [
    {
      id: "beat-dots-note",
      beatId: beat.id,
      measureId: measure.id,
      string: 3,
      fret: 2,
      fretText: "2",
      x: 40,
      y: 60,
    },
  ];
  const strings: ILXMStringLineLayout[] = [
    { index: 1, x1: 0, y1: 20, x2: 100, y2: 20 },
    { index: 6, x1: 0, y1: 70, x2: 100, y2: 70 },
  ];

  return { measure, beatLayouts, noteLayouts, strings };
};

describe("groupContiguousMarks", () => {
  it("4/4 中短时值连梁不会跨过四分音符拍组边界", () => {
    const measure = createMeasure([
      createBeat("beat-1", 0, "sixteenth"),
      createBeat("beat-2", 240, "sixteenth"),
      createBeat("beat-3", 480, "eighth"),
      createBeat("beat-4", 960, "eighth"),
      createBeat("beat-5", 1440, "eighth"),
    ]);
    const groups = groupContiguousMarks(
      measure,
      createMarkMap([
        createMark("beat-1", 2),
        createMark("beat-2", 2),
        createMark("beat-3", 1),
        createMark("beat-4", 1),
        createMark("beat-5", 1),
      ]),
    );

    expect(getGroupBeatIds(groups)).toEqual([
      ["beat-1", "beat-2", "beat-3"],
      ["beat-4", "beat-5"],
    ]);
  });

  it("附点八分和十六分在同拍内分到同一连梁组", () => {
    const measure = createMeasure([
      createBeat("beat-dotted-eighth", 0, "eighth", 1),
      createBeat("beat-sixteenth", 720, "sixteenth"),
      createBeat("beat-next-eighth", 960, "eighth"),
      createBeat("beat-next-eighth-2", 1440, "eighth"),
    ]);
    const groups = groupContiguousMarks(
      measure,
      createMarkMap([
        createMark("beat-dotted-eighth", 1),
        createMark("beat-sixteenth", 2),
        createMark("beat-next-eighth", 1),
        createMark("beat-next-eighth-2", 1),
      ]),
    );

    expect(getGroupBeatIds(groups)).toEqual([
      ["beat-dotted-eighth", "beat-sixteenth"],
      ["beat-next-eighth", "beat-next-eighth-2"],
    ]);
  });
});

describe("layoutBeamSegments", () => {
  it("按 level 为八分加两个十六分生成共享连梁", () => {
    const beamSegments = layoutBeamSegments([
      createMark("beat-eighth", 1, 10),
      createMark("beat-sixteenth-1", 2, 20),
      createMark("beat-sixteenth-2", 2, 30),
    ]);

    expect(beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: ["beat-eighth", "beat-sixteenth-1", "beat-sixteenth-2"],
          x1: 10,
          x2: 30,
          y: 100,
        }),
        expect.objectContaining({
          kind: "shared",
          level: 2,
          beatIds: ["beat-sixteenth-1", "beat-sixteenth-2"],
          x1: 20,
          x2: 30,
          y: 95,
        }),
      ]),
    );
  });

  it("附点 beat 在高层级不合并为共享连梁而生成 partial beam", () => {
    const beamSegments = layoutBeamSegments(
      [
        createMark("beat-sixteenth", 2, 10),
        createMark("beat-dotted-sixteenth", 2, 20),
      ],
      new Map([
        ["beat-sixteenth", 0],
        ["beat-dotted-sixteenth", 1],
      ]),
    );

    expect(beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: ["beat-sixteenth", "beat-dotted-sixteenth"],
        }),
        expect.objectContaining({
          kind: "partial",
          level: 2,
          beatIds: ["beat-sixteenth"],
          direction: "right",
        }),
        expect.objectContaining({
          kind: "partial",
          level: 2,
          beatIds: ["beat-dotted-sixteenth"],
          direction: "left",
        }),
      ]),
    );
  });
});

describe("layoutDurationBeams 附点布局", () => {
  it("无附点 beat 保留空锚点数组", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(0);

    expect(
      layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
        .durationMarks[0],
    ).toMatchObject({ dots: 0, dotAnchors: [] });
  });

  it("单附点 beat 输出一个位于第一层连梁上方的锚点", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(1);

    expect(
      layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
        .durationMarks[0],
    ).toMatchObject({
      dots: 1,
      dotAnchors: [
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X,
          // 第一层连梁 y=108，附点向上避让 5px。
          y: 103,
        },
      ],
    });
  });

  it("双附点 beat 输出两个等高且按固定间距排列的锚点", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(2);

    expect(
      layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
        .durationMarks[0],
    ).toMatchObject({
      dots: 2,
      dotAnchors: [
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X,
          y: 103,
        },
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X + LXM_DURATION_DOT_GAP_X,
          y: 103,
        },
      ],
    });
  });

  it("附点十六分的附点位于第二层 partial beam 上方", () => {
    const firstBeat = createBeat("beat-dotted-sixteenth", 0, "sixteenth", 1);
    const secondBeat = createBeat("beat-eighth", 360, "eighth");
    const measure = createMeasure([firstBeat, secondBeat]);
    const durationLayout = layoutDurationBeams(
      measure,
      [
        {
          id: firstBeat.id,
          measureId: measure.id,
          tick: 0,
          x: 40,
          width: 24,
          rhythm: firstBeat.rhythm,
          columnIndex: 0,
        },
        {
          id: secondBeat.id,
          measureId: measure.id,
          tick: 360,
          x: 64,
          width: 24,
          rhythm: secondBeat.rhythm,
          columnIndex: 1,
        },
      ],
      [
        {
          id: "note-dotted-sixteenth",
          beatId: firstBeat.id,
          measureId: measure.id,
          string: 3,
          fret: 2,
          fretText: "2",
          x: 40,
          y: 60,
        },
        {
          id: "note-eighth",
          beatId: secondBeat.id,
          measureId: measure.id,
          string: 3,
          fret: 3,
          fretText: "3",
          x: 64,
          y: 60,
        },
      ],
      [
        { index: 1, x1: 0, y1: 20, x2: 100, y2: 20 },
        { index: 6, x1: 0, y1: 70, x2: 100, y2: 70 },
      ],
    );
    const dot = durationLayout.durationMarks[0]?.dotAnchors[0];
    const partialBeam = durationLayout.beamSegments.find(
      (segment) => segment.kind === "partial" && segment.level === 2,
    );

    expect(dot).toBeDefined();
    expect(partialBeam).toBeDefined();
    expect(dot!.y).toBeLessThan(partialBeam!.y - partialBeam!.thickness);
  });
});

describe("layoutDurationBeams 谱面时值符号", () => {
  it("和弦符干从最大 note.y 延伸到固定 rhythm lane", () => {
    const beat = {
      ...createBeat("beat-chord", 0, "quarter"),
      notes: [
        { id: "note-high", string: 2, fret: 3 },
        { id: "note-low", string: 5, fret: 7 },
      ],
    };
    const measure = createMeasure([beat]);
    const beatLayouts: ILXMBeatLayout[] = [
      {
        id: beat.id,
        measureId: measure.id,
        tick: 0,
        x: 40,
        width: 80,
        rhythm: beat.rhythm,
        columnIndex: 0,
      },
    ];
    const noteLayouts: ILXMNoteLayout[] = [
      {
        id: "note-high",
        beatId: beat.id,
        measureId: measure.id,
        string: 2,
        fret: 3,
        fretText: "3",
        x: 40,
        y: 44,
      },
      {
        id: "note-low",
        beatId: beat.id,
        measureId: measure.id,
        string: 5,
        fret: 7,
        fretText: "7",
        x: 40,
        y: 68,
      },
    ];
    const strings: ILXMStringLineLayout[] = [
      { index: 1, x1: 0, y1: 20, x2: 120, y2: 20 },
      { index: 6, x1: 0, y1: 70, x2: 120, y2: 70 },
    ];

    const mark = layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
      .durationMarks[0]!;

    expect({
      stemX: mark.stemX,
      stemY1: mark.stemY1,
      stemY2: mark.stemY2,
    }).toEqual({
      stemX: 40,
      stemY1: 74,
      stemY2: 108,
    });
  });

  it("六种基础时值输出可区分的节奏头、符干状态和连梁层级", () => {
    const bases: ILXMMeasure["beats"][number]["rhythm"]["base"][] = [
      "whole",
      "half",
      "quarter",
      "eighth",
      "sixteenth",
      "thirtySecond",
    ];

    const symbols = bases.map((base) => {
      const { measure, beatLayouts, noteLayouts, strings } =
        createDurationLayoutInputs(0, base);
      const mark = layoutDurationBeams(
        measure,
        beatLayouts,
        noteLayouts,
        strings,
      ).durationMarks[0]!;

      return {
        base,
        headGlyph: mark.head.glyph,
        stemVisible: mark.stemVisible,
        sustainCount: mark.sustainMarks.length,
        beamLevel: mark.beamLevel,
      };
    });

    expect(symbols).toEqual([
      {
        base: "whole",
        headGlyph: "\uE0A2",
        stemVisible: true,
        sustainCount: 3,
        beamLevel: 0,
      },
      {
        base: "half",
        headGlyph: "\uE0A3",
        stemVisible: true,
        sustainCount: 1,
        beamLevel: 0,
      },
      {
        base: "quarter",
        headGlyph: "\uE0A4",
        stemVisible: true,
        sustainCount: 0,
        beamLevel: 0,
      },
      {
        base: "eighth",
        headGlyph: "\uE0A4",
        stemVisible: true,
        sustainCount: 0,
        beamLevel: 1,
      },
      {
        base: "sixteenth",
        headGlyph: "\uE0A4",
        stemVisible: true,
        sustainCount: 0,
        beamLevel: 2,
      },
      {
        base: "thirtySecond",
        headGlyph: "\uE0A4",
        stemVisible: true,
        sustainCount: 0,
        beamLevel: 3,
      },
    ]);
  });

  it("全音符把剩余三个四分单位布局为 beat slot 内的延续占位线", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(0, "whole");
    beatLayouts[0]!.width = 80;

    const mark = layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
      .durationMarks[0]!;

    expect(mark.sustainMarks).toEqual([
      { unitIndex: 1, x1: 65, x2: 75, y: 45, thickness: 1 },
      { unitIndex: 2, x1: 85, x2: 95, y: 45, thickness: 1 },
      { unitIndex: 3, x1: 105, x2: 115, y: 45, thickness: 1 },
    ]);
    expect(mark.sustainMarks.every(({ x1, x2 }) => x1 >= 40 && x2 <= 120)).toBe(
      true,
    );
  });

  it("按弦编号计算六线谱中点，不依赖 strings 数组顺序或谱面起始 Y", () => {
    const { measure, beatLayouts, noteLayouts } = createDurationLayoutInputs(
      0,
      "half",
    );
    const unorderedStrings: ILXMStringLineLayout[] = [
      { index: 4, x1: 0, y1: 156, x2: 100, y2: 156 },
      { index: 1, x1: 0, y1: 120, x2: 100, y2: 120 },
      { index: 6, x1: 0, y1: 180, x2: 100, y2: 180 },
      { index: 2, x1: 0, y1: 132, x2: 100, y2: 132 },
      { index: 5, x1: 0, y1: 168, x2: 100, y2: 168 },
      { index: 3, x1: 0, y1: 144, x2: 100, y2: 144 },
    ];

    const mark = layoutDurationBeams(
      measure,
      beatLayouts,
      noteLayouts,
      unorderedStrings,
    ).durationMarks[0]!;

    expect(mark.sustainMarks).toHaveLength(1);
    expect(mark.sustainMarks[0]!.y).toBe(150);
  });

  it("全音符和二分音符的所有占位线都位于第三、四弦之间", () => {
    const strings: ILXMStringLineLayout[] = [20, 32, 44, 56, 68, 80].map(
      (y, index) => ({
        index: index + 1,
        x1: 0,
        y1: y,
        x2: 120,
        y2: y,
      }),
    );

    for (const base of ["whole", "half"] as const) {
      const { measure, beatLayouts, noteLayouts } = createDurationLayoutInputs(
        0,
        base,
      );
      const mark = layoutDurationBeams(
        measure,
        beatLayouts,
        noteLayouts,
        strings,
      ).durationMarks[0]!;

      expect(mark.sustainMarks.length).toBe(base === "whole" ? 3 : 1);
      expect(
        mark.sustainMarks.every((sustainMark) => sustainMark.y === 50),
      ).toBe(true);
    }
  });

  it("缺少第一弦或第六弦时抛出包含 measureId 的明确错误", () => {
    const { measure, beatLayouts, noteLayouts } = createDurationLayoutInputs(
      0,
      "half",
    );
    const invalidStringSets: ILXMStringLineLayout[][] = [
      [
        { index: 2, x1: 0, y1: 32, x2: 100, y2: 32 },
        { index: 6, x1: 0, y1: 80, x2: 100, y2: 80 },
      ],
      [
        { index: 1, x1: 0, y1: 20, x2: 100, y2: 20 },
        { index: 5, x1: 0, y1: 68, x2: 100, y2: 68 },
      ],
    ];

    for (const invalidStrings of invalidStringSets) {
      expect(() =>
        layoutDurationBeams(measure, beatLayouts, noteLayouts, invalidStrings),
      ).toThrow(`时值布局缺少边界弦线：measureId=${measure.id}`);
    }
  });

  it("孤立的八分、十六分和三十二分音符输出对应 composite flag", () => {
    const bases = ["eighth", "sixteenth", "thirtySecond"] as const;

    const flags = bases.map((base) => {
      const { measure, beatLayouts, noteLayouts, strings } =
        createDurationLayoutInputs(0, base);
      const layout = layoutDurationBeams(
        measure,
        beatLayouts,
        noteLayouts,
        strings,
      );

      return {
        base,
        beamSegments: layout.beamSegments,
        flagGlyph: layout.durationMarks[0]!.flag?.glyph,
      };
    });

    expect(flags).toEqual([
      { base: "eighth", beamSegments: [], flagGlyph: "\uE241" },
      { base: "sixteenth", beamSegments: [], flagGlyph: "\uE243" },
      { base: "thirtySecond", beamSegments: [], flagGlyph: "\uE245" },
    ]);
  });

  it("连续八分音符使用 shared beam 且不重复输出 flag", () => {
    const beats = [
      createBeat("beat-eighth-1", 0, "eighth"),
      createBeat("beat-eighth-2", 480, "eighth"),
    ];
    const measure = createMeasure(beats);
    const beatLayouts: ILXMBeatLayout[] = beats.map((beat, index) => ({
      id: beat.id,
      measureId: measure.id,
      tick: beat.tick,
      x: 40 + index * 24,
      width: 24,
      rhythm: beat.rhythm,
      columnIndex: index,
    }));
    const noteLayouts: ILXMNoteLayout[] = beats.map((beat, index) => ({
      id: `${beat.id}-note`,
      beatId: beat.id,
      measureId: measure.id,
      string: 3,
      fret: 2,
      fretText: "2",
      x: 40 + index * 24,
      y: 60,
    }));
    const strings: ILXMStringLineLayout[] = [
      { index: 1, x1: 0, y1: 20, x2: 100, y2: 20 },
      { index: 6, x1: 0, y1: 70, x2: 100, y2: 70 },
    ];

    const layout = layoutDurationBeams(
      measure,
      beatLayouts,
      noteLayouts,
      strings,
    );

    expect({
      beams: layout.beamSegments.map((segment) => ({
        kind: segment.kind,
        level: segment.level,
        beatIds: segment.beatIds,
      })),
      flags: layout.durationMarks.map((mark) => mark.flag),
    }).toEqual({
      beams: [
        {
          kind: "shared",
          level: 1,
          beatIds: ["beat-eighth-1", "beat-eighth-2"],
        },
      ],
      flags: [null, null],
    });
  });
});
