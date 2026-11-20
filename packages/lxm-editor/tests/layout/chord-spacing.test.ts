import { describe, expect, it } from "vitest";
import {
  buildLayout,
  copyChordPreset,
  EXAMPLE_MVP_6_DOCUMENT,
} from "../../src";
import { summarizeMeasureSpacingWidth } from "../../src/layout/structure/measure-spacing";
import { createChordBlock } from "../../src/layout/music-text/music-text-layout";
import { chordDisplayTrack } from "../../src/layout/music-text/chord-display";
import { TICKS_PER_QUARTER } from "../../src/core/constants";

/** 复用有效节奏数据，只移除其它文本和技巧，隔离和弦的横向贡献。 */
const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 2);
  track.techniques = [];
  for (const measure of track.measures) {
    measure.lyrics = [];
    measure.chordSymbols = [];
  }
  return document;
};
const chord = (beatId: string, id = "chord") => ({
  id,
  beatId,
  display: "nameAndDiagram" as const,
  chord: copyChordPreset("C")!,
});

describe("和弦拍点左对齐及按需空间", () => {
  it.each([
    { showChordDiagrams: true, gIndex: 2 },
    { showChordDiagrams: false, gIndex: 2 },
    { showChordDiagrams: true, gIndex: 3 },
    { showChordDiagrams: false, gIndex: 3 },
  ])("3/4 的 F、G 保持固有间距，指法图 $showChordDiagrams，G 音符索引 $gIndex", ({ showChordDiagrams, gIndex }) => {
    const document = fixture();
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    track.measures = [measure];
    measure.timeSignature = { numerator: 3, denominator: 4 };
    measure.tuplets = [];
    measure.numberedVoice = { events: [], tuplets: [] };
    const noteBeat = (measureId: string, index: number) => ({
      id: `${measureId}-beat-${index}`,
      tick: index * TICKS_PER_QUARTER / 2,
      rhythm: { base: "eighth" as const, dots: 0 as const },
      kind: "notes" as const,
      notes: [{ id: `${measureId}-note-${index}`, string: 3 as const, fret: 2 }],
    });
    measure.beats = Array.from({ length: 6 }, (_, index) => {
      const beat = noteBeat(measure.id, index);
      return gIndex === 2 && index >= 3 ? { ...beat, kind: "rest", notes: [] } : beat;
    });
    measure.chordSymbols = [
      { ...chord(measure.beats[0]!.id, "F"), chord: copyChordPreset("F")! },
      { ...chord(measure.beats[gIndex]!.id, "G"), chord: copyChordPreset("G")! },
    ];
    // 参考图的 F、G 位于含 C、Am 和空小节的同一行，G 对齐后半小节的首音。
    if (gIndex === 3) {
      const neighbors = ["C", "Am", null].map((name, index) => {
        const neighbor = structuredClone(measure);
        neighbor.id = `neighbor-${index}`;
        neighbor.beats = name ? Array.from({ length: 6 }, (_, slot) => noteBeat(neighbor.id, slot)) : [];
        neighbor.chordSymbols = name
          ? [{ ...chord(neighbor.beats[0]!.id, name), chord: copyChordPreset(name)! }]
          : [];
        return neighbor;
      });
      track.measures = [neighbors[0]!, neighbors[1]!, measure, neighbors[2]!];
    }
    const projected = chordDisplayTrack(track, showChordDiagrams).measures.find((item) => item.id === measure.id)!;
    const spacing = summarizeMeasureSpacingWidth(projected, "compact");
    const intrinsicSpan = spacing.columns.slice(0, gIndex).reduce((sum, column) => sum + column.idealWidth, 0);
    for (const purpose of ["editing", "presentation"] as const) {
      const layout = buildLayout(document, { density: "compact", purpose, systemWidth: 733, showChordDiagrams });
      expect(layout.systems).toHaveLength(1);
      const positioned = layout.systems[0]!.measures[track.measures.indexOf(measure)]!;
      const [f, g] = positioned.chordSymbols!;
      for (const symbol of [f!, g!]) {
        const beat = positioned.beats.find((item) => item.id === symbol.beatId)!;
        expect(symbol.diagram?.lines[0]!.x1 ?? symbol.label.x).toBeCloseTo(beat.x);
      }
      expect(g!.bounds.x - f!.bounds.x - f!.bounds.width).toBeGreaterThanOrEqual(4 - 1e-8);
      expect(positioned.beats[gIndex]!.x - positioned.beats[0]!.x).toBeCloseTo(intrinsicSpan);
    }
  });

  it("孤立和弦不扩宽下一拍，网格左边对齐拍点，名称居中且距顶线固定9", () => {
    const document = fixture();
    const measure = document.score.tracks[0]!.measures[0]!;
    const original = summarizeMeasureSpacingWidth(measure, "compact");
    measure.chordSymbols = [chord(measure.beats[0]!.id)];
    const withChord = summarizeMeasureSpacingWidth(measure, "compact");
    expect(withChord.columns.map((c) => c.idealWidth)).toEqual(
      original.columns.map((c) => c.idealWidth),
    );
    const layout = buildLayout(document, {
      density: "compact",
      systemWidth: 800,
    });
    const positioned = layout.systems[0]!.measures[0]!;
    const symbol = positioned.chordSymbols![0]!;
    expect(symbol.diagram!.lines[0]!.x1).toBe(positioned.beats[0]!.x);
    expect(symbol.label.x).toBeCloseTo(positioned.beats[0]!.x + 13.5);
    expect(symbol.diagram!.lines[0]!.y1 - symbol.label.y).toBeCloseTo(9);
  });
  it("非相邻和弦借用中间空拍，只有真正不足的跨度才补宽", () => {
    const document = fixture();
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.chordSymbols = [
      chord(measure.beats[0]!.id),
      chord(measure.beats[2]!.id, "second"),
    ];
    const summary = summarizeMeasureSpacingWidth(measure, "compact");
    const block = createChordBlock(measure.chordSymbols[0]!);
    expect(summary.columns[0]!.idealWidth).toBeLessThan(block.bounds.width);
    const span = summary.columns
      .slice(0, 2)
      .reduce((sum, c) => sum + c.idealWidth, 0);
    expect(span).toBeGreaterThanOrEqual(block.bounds.width + 4 - 0.001);
  });
  it("前一小节的孤立超长名称也受整行左右边界保护", () => {
    const document = fixture();
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.chordSymbols = [chord(measure.beats.at(-1)!.id)];
    measure.chordSymbols[0]!.chord.name = "Cmaj7(add9)/G".repeat(12);
    const layout = buildLayout(document, {
      density: "compact",
      systemWidth: 3000,
    });
    const system = layout.systems[0]!;
    const symbol = system.measures[0]!.chordSymbols![0]!;
    expect(symbol.bounds.x).toBeGreaterThanOrEqual(system.x);
    expect(symbol.bounds.x + symbol.bounds.width + 4).toBeLessThanOrEqual(
      system.x + system.width + 0.001,
    );
  });
  it.each([180, 420, 800])(
    "行宽 %i 下跨小节和弦不碰撞且行尾不溢出",
    (systemWidth) => {
      const document = fixture();
      const [a, b] = document.score.tracks[0]!.measures;
      a!.chordSymbols = [chord(a!.beats.at(-1)!.id)];
      b!.chordSymbols = [chord(b!.beats[0]!.id, "second")];
      b!.chordSymbols[0]!.chord.name = "Cmaj7(add9)/G";
      const before = JSON.stringify(document);
      const layout = buildLayout(document, { density: "compact", systemWidth });
      for (const system of layout.systems) {
        const chords = system.measures.flatMap(
          (measure) => measure.chordSymbols!,
        );
        if (chords.length === 2)
          expect(
            chords[0]!.bounds.x + chords[0]!.bounds.width + 4,
          ).toBeLessThanOrEqual(chords[1]!.bounds.x + 0.001);
        for (const symbol of chords)
          expect(symbol.bounds.x + symbol.bounds.width + 4).toBeLessThanOrEqual(
            system.x + system.width + 0.001,
          );
      }
      expect(JSON.stringify(document)).toBe(before);
    },
  );
});
