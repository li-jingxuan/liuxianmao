import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp2.json";
import type { ILXMTechnique } from "../../src/core/types";
import { buildLayout, hitTestTechnique } from "../../src/layout";
import { buildScoreScene } from "../../src/presentation/score-scene";
import {
  boundsIntersect,
  getFretTextBounds,
  getTechniqueInkBounds,
  getTextBounds,
  padBounds,
} from "../../src/layout/techniques/technique-geometry";
import { fretHalfWidth } from "../../src/layout/techniques/technique-spacing";
import { chordPair } from "../fixtures/technique-dense-chords";

const fixture = (technique: ILXMTechnique) => {
  const document = structuredClone(source);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 1);
  track.measures[0]!.beats.forEach((beat, index) => {
    beat.notes = [{ id: `note-${index}`, string: 3, fret: 12 + index }];
  });
  track.techniques = [technique];
  return document;
};

const annotations: ILXMTechnique[] = [
  { id: "h", type: "hammerOn", fromNoteId: "note-0", toNoteId: "note-1" },
  { id: "p", type: "pullOff", fromNoteId: "note-0", toNoteId: "note-1" },
  { id: "s", type: "slideUp", fromNoteId: "note-0", toNoteId: "note-1" },
  { id: "pm", type: "palmMute", fromBeatId: "mvp2-beat-1-1", toBeatId: "mvp2-beat-1-4" },
  { id: "ring", type: "letRing", fromBeatId: "mvp2-beat-1-1", toBeatId: "mvp2-beat-1-4" },
  { id: "ah", type: "artificialHarmonic", fromNoteId: "note-0" },
  { id: "tap", type: "tapping", fromNoteId: "note-0" },
  { id: "tr", type: "trill", fromNoteId: "note-0", auxiliaryFret: 24 },
  { id: "full", type: "bend", fromNoteId: "note-0", semitones: 2 },
  { id: "half", type: "bend", fromNoteId: "note-0", semitones: 1 },
  { id: "nh", type: "naturalHarmonic", fromNoteId: "note-0" },
];

describe("REQ037 谱面技巧文字比例与原命中范围", () => {
  it.each(annotations)("$id 编辑和输出使用相同字号，原字形外围仍可点击", (technique) => {
    for (const purpose of ["editing", "presentation"] as const) {
      for (const density of ["compact", "comfortable"] as const) {
        const layout = buildLayout(fixture(technique), { purpose, density });
        const segment = layout.systems[0]!.techniques[0]!;
        const label = segment.texts[0]!;
        const natural = technique.type === "naturalHarmonic";
        expect(label.fontSize).toBeCloseTo(natural ? 8 * 7 / 9 : 7);
        expect(label.fontSize).toBeGreaterThanOrEqual(6);

        // 原字号连同原描边与 4 单位 padding 的四角都必须仍落在可点框内。
        // 这些点包含缩小后的文字和相同 padding 已经不能覆盖的位置。
        const original = padBounds(getTextBounds({ ...label, fontSize: natural ? 8 : 9 },
          natural ? 0.4 : 1), 4);
        for (const x of [original.x + 0.01, original.x + original.width - 0.01]) {
          for (const y of [original.y + 0.01, original.y + original.height - 0.01]) {
            expect(hitTestTechnique(layout, { x, y })).toBe(technique.id);
          }
        }

        // SVG 编辑、打印及 Canvas 图片共用 scene；图元必须直接带相同字号。
        const sceneText = buildScoreScene(layout).systems[0]!.items.find(
          (item) => item.kind === "text" && item.techniqueId === technique.id,
        );
        expect(sceneText).toMatchObject({ kind: "text", fontSize: label.fontSize });
        expect(segment.collisionBounds).toEqual(padBounds(segment.visualBounds, 2));
      }
    }
  });

  it("自然泛音占位与最终字形一致，连接弧线避开缩小后的完整泛音", () => {
    const document = fixture(annotations.at(-1)!);
    document.score.tracks[0]!.techniques!.push(annotations[0]!);
    const system = buildLayout(document).systems[0]!;
    const harmonic = system.techniques.find((segment) => segment.type === "naturalHarmonic")!;
    const curve = system.techniques.find((segment) => segment.type === "hammerOn")!;
    const label = harmonic.texts[0]!;
    expect(fretHalfWidth(12, true) * 2).toBeCloseTo(harmonic.visualBounds.width);
    const ink = getTechniqueInkBounds(harmonic);
    expect(ink).toHaveLength(1);
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(ink[0]![key]).toBeCloseTo(harmonic.visualBounds[key]);
    }
    const projected = getFretTextBounds({
      id: "note-0", beatId: "mvp2-beat-1-1", measureId: system.measures[0]!.id, string: 3, fret: 12,
      fretText: "<12>", x: label.x, y: label.y - 2.5,
    });
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(projected[key]).toBeCloseTo(harmonic.visualBounds[key]);
    }
    expect(getTechniqueInkBounds(curve).some((piece) => boundsIntersect(piece, projected))).toBe(false);
  });

  it("tr 缩小后收紧波浪线，原波浪线尾端外围仍然可点", () => {
    const layout = buildLayout(fixture(annotations.find((item) => item.type === "trill")!));
    const segment = layout.systems[0]!.techniques[0]!;
    const label = segment.texts[0]!;
    const values = segment.path!.d.match(/-?(?:\d*\.)?\d+/g)!.map(Number);
    const oldLabelWidth = 5 * 9 * 0.65; // "tr 24" 原来的保守宽度。
    const oldWaveEnd = values.at(-2)! + oldLabelWidth - getTextBounds(label).width;
    expect(hitTestTechnique(layout, { x: oldWaveEnd + 3.9, y: values.at(-1)! })).toBe("tr");
  });

  it("密集六弦 H/P 的既有内嵌标签仍为 6，原标签可点范围保留", () => {
    for (const type of ["hammerOn", "pullOff"] as const) {
      const layout = buildLayout(chordPair([1, 2, 3, 4, 5, 6], type, true));
      const inline = layout.systems.flatMap((system) => system.techniques)
        .filter((segment) => segment.texts.some((label) => label.fontSize === 6));
      expect(inline.length).toBeGreaterThan(0);
      for (const segment of inline) {
        expect(segment.texts.every((label) => label.fontSize === 6)).toBe(true);
        const label = segment.texts[0]!;
        expect(hitTestTechnique(layout, { x: label.x, y: label.y - 3 })).toBe(segment.techniqueId);
      }
    }
  });
});
