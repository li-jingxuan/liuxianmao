import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { loadDocument } from "../../src/core/document/loader";
import type { ILXMBeat } from "../../src/core/types";
import { buildLayout } from "../../src/layout";
import {
  layoutBeamSegments,
  LXM_DURATION_PARTIAL_BEAM_LENGTH,
} from "../../src/layout/rhythm/duration-beam-layout";
import { LXM_DURATION_STEM_STROKE_WIDTH } from "../../src/layout/layout-constants";
import type { ILXMDurationMarkLayout } from "../../src/layout/layout-types";

const mark = (beatId: string, beamLevel: number, stemX: number): ILXMDurationMarkLayout => ({
  beatId,
  measureId: "minimal-duration-pair",
  head: { glyph: "\uE0A4", x: stemX, y: 60, fontSize: 16 },
  stemVisible: true,
  stemX,
  stemY1: 60,
  stemY2: 100,
  beamY: 100,
  beamLevel,
  sustainMarks: [],
  flag: null,
  dots: 0,
  dotAnchors: [],
});

const beat = (
  id: string,
  tick: number,
  base: ILXMBeat["rhythm"]["base"],
  dots = 0,
): ILXMBeat => ({
  id,
  tick,
  rhythm: { base, dots },
  kind: "notes",
  notes: [{ id: `${id}-note`, string: 3, fret: 2 }],
});

const compactTail = (tail: ILXMBeat[]) => {
  const document = structuredClone(EXAMPLE_MVP_2);
  const track = document.score.tracks[0]!;
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = [{
    ...track.measures[0]!,
    id: "compact-duration-tail",
    timeSignature: { numerator: 4, denominator: 4 },
    barline: "final",
    lyrics: [],
    chordSymbols: [],
    tuplets: [],
    numberedVoice: { events: [], tuplets: [] },
    beats: [
      ...Array.from({ length: 12 }, (_, i) =>
        beat(`dense-${i}`, i * 240, "sixteenth")),
      ...tail,
    ],
  }];
  expect(loadDocument(JSON.stringify(document)).ok).toBe(true);
  return buildLayout(document, {
    density: "compact",
    systemWidth: 170,
    purpose: "presentation",
  }).systems[0]!.measures[0]!;
};

describe("BUG015 compact TAB 小节末尾横梁", () => {
  it("末拍八分加两个十六分保留两层共享横梁且不越小节", () => {
    const measure = compactTail([
      beat("tail-eighth", 2880, "eighth"),
      beat("tail-sixteenth-1", 3360, "sixteenth"),
      beat("tail-sixteenth-2", 3600, "sixteenth"),
    ]);
    const tailBeams = measure.beamSegments.filter((b) =>
      b.beatIds.includes("tail-sixteenth-2"));
    expect(tailBeams.map((b) => [b.kind, b.level])).toEqual([
      ["shared", 1], ["shared", 2],
    ]);
    for (const b of tailBeams) {
      expect(b.x1).toBeGreaterThanOrEqual(measure.x);
      expect(b.x2).toBeLessThanOrEqual(measure.x + measure.width);
    }
  });

  it("末拍附点八分加十六分的部分横梁不能伸过前一符干", () => {
    const measure = compactTail([
      beat("tail-dotted-eighth", 2880, "eighth", 1),
      beat("tail-sixteenth", 3600, "sixteenth"),
    ]);
    const left = measure.durationMarks.find((m) =>
      m.beatId === "tail-dotted-eighth")!;
    const right = measure.durationMarks.find((m) =>
      m.beatId === "tail-sixteenth")!;
    const partial = measure.beamSegments.find((b) =>
      b.kind === "partial" && b.beatIds.includes(right.beatId))!;
    expect(partial).toBeDefined();
    expect(partial.x1, JSON.stringify({
      measureX: measure.x,
      measureEnd: measure.x + measure.width,
      leftStem: left.stemX,
      rightStem: right.stemX,
      partial,
    })).toBeGreaterThan(left.stemX);
    expect(partial.x2).toBe(right.stemX);
  });

  it("末尾两个附点十六分的短梁不穿过相邻符干，所有时值层数仍完整", () => {
    const measure = compactTail([
      beat("tail-sixteenth", 2880, "sixteenth"),
      beat("tail-dotted-sixteenth-1", 3120, "sixteenth", 1),
      beat("tail-dotted-sixteenth-2", 3480, "sixteenth", 1),
    ]);
    const marks = measure.durationMarks.filter((m) => m.beatId.startsWith("tail-"));
    for (const m of marks) {
      const beams = measure.beamSegments.filter((b) => b.beatIds.includes(m.beatId));
      expect(beams.map((b) => b.level)).toEqual([1, 2]);
      for (const b of beams.filter((b) => b.kind === "partial")) {
        const index = marks.indexOf(m);
        const neighbor = marks[index === 0 ? 1 : index - 1]!;
        if (b.direction === "left") expect(b.x1).toBeGreaterThan(neighbor.stemX);
        else expect(b.x2).toBeLessThan(neighbor.stemX);
        expect(b.x1).toBeGreaterThanOrEqual(measure.x);
        expect(b.x2).toBeLessThanOrEqual(measure.x + measure.width);
      }
    }
  });

  it.each([
    [beat("tail-eighth", 2880, "eighth"),
      beat("tail-dotted-sixteenth", 3360, "sixteenth", 1),
      beat("tail-thirty-second", 3720, "thirtySecond")],
    [beat("tail-eighth", 2880, "eighth"),
      beat("tail-sixteenth", 3360, "sixteenth"),
      beat("tail-thirty-second-1", 3600, "thirtySecond"),
      beat("tail-thirty-second-2", 3720, "thirtySecond")],
  ].map((tail) => ({ tail })))("行末三十二分的共享/部分三层横梁均保留：$tail", ({ tail }) => {
    const measure = compactTail(tail);
    const marks = measure.durationMarks.filter((m) => m.beatId.startsWith("tail-"));
    marks.forEach((m, index) => {
      const beams = measure.beamSegments.filter((b) => b.beatIds.includes(m.beatId));
      expect(beams.map((b) => b.level)).toEqual(
        Array.from({ length: m.beamLevel }, (_, i) => i + 1),
      );
      expect(m.flag).toBeNull();
      for (const b of beams) {
        expect(b.x1).toBeGreaterThanOrEqual(marks[0]!.stemX);
        expect(b.x2).toBeLessThanOrEqual(marks.at(-1)!.stemX);
        expect(b.x2).toBeLessThanOrEqual(measure.x + measure.width);
        if (b.kind === "partial") {
          const neighbor = marks[index === 0 ? 1 : index - 1]!;
          if (b.direction === "left") expect(b.x1).toBeGreaterThan(neighbor.stemX);
          else expect(b.x2).toBeLessThan(neighbor.stemX);
        }
      }
    });
  });

  it.each([
    { base: "eighth", tick: 3360, restDots: 0, glyph: "\uE241" },
    { base: "sixteenth", tick: 3600, restDots: 1, glyph: "\uE243" },
    { base: "thirtySecond", tick: 3720, restDots: 2, glyph: "\uE245" },
  ] as const)("行末孤立$base保留完整旗帜，不生成假短梁", ({ base, tick, restDots, glyph }) => {
    const measure = compactTail([
      { ...beat("tail-rest", 2880, "eighth", restDots), kind: "rest", notes: [] },
      beat("tail-isolated", tick, base),
    ]);
    const isolated = measure.durationMarks.find((m) => m.beatId === "tail-isolated")!;
    expect(isolated.flag?.glyph).toBe(glyph);
    expect(measure.beamSegments.filter((b) => b.beatIds.includes(isolated.beatId))).toEqual([]);
  });
});

describe("BUG015 partial beam 最小回归与对照", () => {
  it("只需同拍两根相距9px的符干即可复现，和行尾分页无关", () => {
    const partial = layoutBeamSegments([
      mark("eighth", 1, 153), mark("sixteenth", 2, 162),
    ]).find((b) => b.kind === "partial")!;
    expect(partial.x1).toBeGreaterThan(153);
    expect(partial.x2).toBe(162);
    expect(partial.x1).toBe(157.5);
  });

  it.each([24, 48])("间距 %ipx 时保留默认12px短梁", (gap) => {
    const partial = layoutBeamSegments([
      mark("eighth", 1, 20), mark("sixteenth", 2, 20 + gap),
    ]).find((b) => b.kind === "partial")!;
    expect(partial.x2 - partial.x1).toBe(LXM_DURATION_PARTIAL_BEAM_LENGTH);
    expect(partial).toMatchObject({ direction: "left", x2: 20 + gap });
  });

  it.each([
    { levels: [1, 2], dotted: [] },
    { levels: [2, 1], dotted: [] },
    { levels: [1, 3], dotted: [] },
    { levels: [3, 1], dotted: [] },
    { levels: [2, 3, 2], dotted: [] },
    { levels: [3, 3], dotted: [0, 1] },
  ])("9px窄列完整表达每音层数且不穿过邻干：$levels，附点$dotted", ({ levels, dotted }) => {
    const marks = levels.map((level, i) => mark(`note-${i}`, level, 40 + i * 9));
    const beams = layoutBeamSegments(marks, new Map(dotted.map((i) => [`note-${i}`, 1])));
    marks.forEach((m, index) => {
      const own = beams.filter((b) => b.beatIds.includes(m.beatId));
      expect(own.map((b) => b.level)).toEqual(
        Array.from({ length: m.beamLevel }, (_, i) => i + 1),
      );
      for (const b of own) {
        expect(b.thickness).toBe(1.5);
        expect(b.x2).toBeGreaterThan(b.x1);
        expect(b.x1).toBeGreaterThanOrEqual(marks[0]!.stemX);
        expect(b.x2).toBeLessThanOrEqual(marks.at(-1)!.stemX);
        if (b.kind === "partial") {
          const neighbor = marks[index === 0 ? 1 : index - 1]!;
          if (b.direction === "left") expect(b.x1).toBeGreaterThan(neighbor.stemX);
          else expect(b.x2).toBeLessThan(neighbor.stemX);
        }
      }
    });
    expect(LXM_DURATION_STEM_STROKE_WIDTH).toBe(0.75);
  });
});
