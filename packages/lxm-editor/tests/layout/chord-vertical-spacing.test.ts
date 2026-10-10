import { describe, expect, it } from "vitest";
import {
  buildLayout,
  copyChordPreset,
  EXAMPLE_MVP_6_DOCUMENT,
  hitTestMusicText,
} from "../../src";
import { getFretTextBounds } from "../../src/layout/technique-geometry";
import type { ILXMSystemLayout } from "../../src/layout/layout-types";

/** 固定三小节低弦音符，隔离上方占位与同一行对齐行为。 */
const createDocument = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 3);
  track.techniques = [];
  track.measures.forEach((measure, index) => {
    measure.lyrics = [];
    measure.beats.forEach((beat, beatIndex) => {
      beat.notes = [
        { id: `vertical-${index}-${beatIndex}`, string: 6, fret: 3 },
      ];
    });
    measure.chordSymbols = [
      {
        id: `chord-${index}`,
        beatId: measure.beats[0]!.id,
        display: "nameAndDiagram",
        chord: copyChordPreset("Am")!,
      },
    ];
  });
  return document;
};
const chordGap = (system: ILXMSystemLayout) =>
  system.measures[0]!.strings[0]!.y1 -
  Math.max(
    ...system.measures
      .flatMap((m) => m.chordSymbols!)
      .map((c) => c.bounds.y + c.bounds.height),
  );
const expectAligned = (system: ILXMSystemLayout) => {
  const chords = system.measures.flatMap((m) => m.chordSymbols!);
  expect(new Set(chords.map((c) => c.label.y)).size).toBe(1);
  const diagrams = chords.filter((c) => c.diagram);
  if (diagrams.length)
    expect(new Set(diagrams.map((c) => c.diagram!.lines[0]!.y1)).size).toBe(1);
};

describe("和弦动态上方占位", () => {
  it("无上方内容仅保留 4 净空，同行对齐及命中同步", () => {
    const layout = buildLayout(createDocument(), { systemWidth: 1800 });
    const system = layout.systems[0]!;
    expect(chordGap(system)).toBeCloseTo(4);
    expectAligned(system);
    for (const chord of system.measures.flatMap((m) => m.chordSymbols!)) {
      expect(chord.bounds.y).toBeGreaterThanOrEqual(system.y);
      expect(
        hitTestMusicText(layout, {
          x: chord.label.x,
          y: chord.diagram!.lines[0]!.y1 + 15,
        }),
      ).toMatchObject({ id: chord.id });
    }
  });
  it("第一弦数字与描边占位，最拥挤小节决定整行公共位置", () => {
    const document = createDocument();
    document.score.tracks[0]!.measures[1]!.beats[0]!.notes[0]!.string = 1;
    const system = buildLayout(document, { systemWidth: 1800 }).systems[0]!;
    const bounds = getFretTextBounds(system.measures[1]!.notes[0]!);
    const chord = system.measures[1]!.chordSymbols![0]!;
    expect(chord.bounds.y + chord.bounds.height + 4).toBeCloseTo(bounds.y);
    expect(chordGap(system)).toBeGreaterThan(4);
    expectAligned(system);
  });
  it("重叠技巧抬高整行，移除后恢复；远处高技巧不抬高和弦", () => {
    const document = createDocument();
    const track = document.score.tracks[0]!;
    track.measures[1]!.beats[0]!.notes[0]!.string = 1;
    const without = buildLayout(document, { systemWidth: 1800 }).systems[0]!;
    track.techniques = [
      {
        id: "overlap",
        type: "tapping",
        fromNoteId: track.measures[1]!.beats[0]!.notes[0]!.id,
      },
    ];
    const withTechnique = buildLayout(document, { systemWidth: 1800 })
      .systems[0]!;
    expect(chordGap(withTechnique)).toBeGreaterThan(chordGap(without));
    const chord = withTechnique.measures[1]!.chordSymbols![0]!;
    expect(chord.bounds.y + chord.bounds.height + 4).toBeCloseTo(
      withTechnique.techniques[0]!.visualBounds.y,
    );
    expectAligned(withTechnique);
    track.techniques = [];
    expect(buildLayout(document, { systemWidth: 1800 }).systems).toEqual([
      without,
    ]);
    const farBeat = track.measures[2]!.beats.at(-1)!;
    farBeat.notes[0]!.string = 1;
    track.techniques = [
      { id: "far", type: "tapping", fromNoteId: farBeat.notes[0]!.id },
    ];
    const distant = buildLayout(document, { systemWidth: 1800 }).systems[0]!;
    const obstacle = distant.techniques[0]!.visualBounds;
    expect(
      distant.measures.every((m) =>
        m.chordSymbols!.every(
          (c) => c.bounds.x + c.bounds.width + 4 < obstacle.x,
        ),
      ),
    ).toBe(true);
    expect(chordGap(distant)).toBeCloseTo(chordGap(without));
  });
  it.each([true, false])(
    "不同品格高度、显示指法图 %s 与窄宽度换行按各行独立计算",
    (showChordDiagrams) => {
      const document = createDocument();
      const track = document.score.tracks[0]!;
      track.measures[1]!.chordSymbols[0]!.chord.diagram!.strings[0]!.fret = 5;
      track.measures[0]!.beats[0]!.notes[0]!.string = 1;
      track.techniques = [
        {
          id: "upper",
          type: "tapping",
          fromNoteId: track.measures[0]!.beats[0]!.notes[0]!.id,
        },
      ];
      const wide = buildLayout(document, {
        systemWidth: 1800,
        showChordDiagrams,
      }).systems[0]!;
      expectAligned(wide);
      if (showChordDiagrams) {
        const [a, b] = wide.measures.flatMap((m) => m.chordSymbols!);
        expect(b!.diagram!.bounds.height).toBeGreaterThan(
          a!.diagram!.bounds.height,
        );
      }
      const narrow = buildLayout(document, {
        systemWidth: 180,
        showChordDiagrams,
      });
      expect(narrow.systems.length).toBeGreaterThan(1);
      expect(chordGap(narrow.systems[0]!)).toBeGreaterThan(4);
      for (const system of narrow.systems.slice(1)) {
        expect(chordGap(system)).toBeCloseTo(4);
        expectAligned(system);
      }
      for (let i = 1; i < narrow.systems.length; i++)
        expect(
          narrow.systems[i]!.y -
            (narrow.systems[i - 1]!.y + narrow.systems[i - 1]!.height),
        ).toBeCloseTo(12);
    },
  );
});
