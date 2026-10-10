import { describe, expect, it } from "vitest";
import {
  buildLayout,
  collectMusicTextMeasureRequests,
  EXAMPLE_MVP_6_DOCUMENT,
  copyChordPreset,
  hitTestMusicText,
} from "../../src";

describe("全局和弦指法图视图", () => {
  it("全局开启显示旧隐藏图、无图保留名称；省略参数兼容旧行为，输入不变", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.chordSymbols = [
      {
        id: "hidden",
        beatId: measure.beats[0]!.id,
        display: "name",
        chord: copyChordPreset("F")!,
      },
      {
        id: "no-diagram",
        beatId: measure.beats[1]!.id,
        display: "name",
        chord: { name: "C", diagram: null },
      },
    ];
    const before = JSON.stringify(document);
    const chords = (enabled?: boolean) =>
      buildLayout(document, { showChordDiagrams: enabled }).systems.flatMap(
        (s) => s.measures.flatMap((m) => m.chordSymbols ?? []),
      );
    expect(chords().find((c) => c.id === "hidden")!.diagram).toBeNull();
    expect(chords(true).find((c) => c.id === "hidden")!.diagram).not.toBeNull();
    expect(chords(true).find((c) => c.id === "no-diagram")!.diagram).toBeNull();
    expect(chords(false).every((c) => c.diagram === null)).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
    expect(
      collectMusicTextMeasureRequests(document, true).length,
    ).toBeGreaterThan(collectMusicTextMeasureRequests(document, false).length);
  });
  it("隐藏图收回高度和命中区域；重新开启恢复同一布局与图", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const before = JSON.stringify(document);
    const on = buildLayout(document, { showChordDiagrams: true });
    const off = buildLayout(document, { showChordDiagrams: false });
    expect(off.height).toBeLessThan(on.height);
    for (const system of off.systems)
      for (const measure of system.measures)
        for (const chord of measure.chordSymbols ?? []) {
          expect(chord.diagram).toBeNull();
          const bounds = off.hitIndex.musicTextBounds!.find(
            (b) => b.id === chord.id,
          )!;
          expect(bounds.height).toBe(chord.label.bounds.height);
          expect(
            hitTestMusicText(off, {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
            })?.id,
          ).toBe(chord.id);
        }
    expect(buildLayout(document, { showChordDiagrams: true })).toEqual(on);
    expect(JSON.stringify(document)).toBe(before);
  });
});
