import { describe, expect, it } from "vitest";

import type { ILXMMeasure } from "../../src/core/types";
import {
  groupContiguousMarks,
  layoutBeamSegments,
} from "../../src/layout/duration-beam-layout";
import type { ILXMDurationMarkLayout } from "../../src/layout/layout-types";

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
});

const createMarkMap = (
  marks: ILXMDurationMarkLayout[],
): Map<string, ILXMDurationMarkLayout> =>
  new Map(marks.map((mark) => [mark.beatId, mark]));

const getGroupBeatIds = (
  groups: ILXMDurationMarkLayout[][],
): string[][] => groups.map((group) => group.map((mark) => mark.beatId));

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
