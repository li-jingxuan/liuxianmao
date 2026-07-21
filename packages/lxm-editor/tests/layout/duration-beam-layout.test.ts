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
  stemX,
  stemY1: 0,
  stemY2: 0,
  beamY,
  beamLevel,
  dots: 0,
  dotAnchors: [],
});

const createMarkMap = (
  marks: ILXMDurationMarkLayout[],
): Map<string, ILXMDurationMarkLayout> =>
  new Map(marks.map((mark) => [mark.beatId, mark]));

const getGroupBeatIds = (
  groups: ILXMDurationMarkLayout[][],
): string[][] => groups.map((group) => group.map((mark) => mark.beatId));

const createDurationLayoutInputs = (dots: number) => {
  const beat = createBeat("beat-dots", 0, "eighth", dots);
  const measure = createMeasure([beat]);
  const beatLayouts: ILXMBeatLayout[] = [
    {
      id: beat.id,
      measureId: measure.id,
      tick: beat.tick,
      x: 40,
      width: 24,
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

  it("单附点 beat 输出一个相对符干和连梁基线的锚点", () => {
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
          y: 60,
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
          y: 60,
        },
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X + LXM_DURATION_DOT_GAP_X,
          y: 60,
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
