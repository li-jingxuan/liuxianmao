import { describe, expect, it } from "vitest";
import {
  buildLayout,
  copyChordPreset,
  EXAMPLE_MVP_6_DOCUMENT,
} from "../../src";
import { summarizeMeasureSpacingWidth } from "../../src/layout/measure-spacing";
import { createChordBlock } from "../../src/layout/music-text-layout";

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
  it("孤立和弦不扩宽下一拍，网格左边对齐拍点，名称居中且距顶线固定12", () => {
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
    expect(symbol.label.x).toBeCloseTo(positioned.beats[0]!.x + 19.125);
    expect(symbol.diagram!.lines[0]!.y1 - symbol.label.y).toBeCloseTo(12);
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
