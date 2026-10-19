import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import { buildLayout, hitTestTechnique } from "../../src/layout";
import {
  boundsIntersect,
  getFretTextBounds,
  getTechniqueInkBounds,
} from "../../src/layout/technique-geometry";
import type { ILXMTechniqueSegmentLayout } from "../../src/layout/layout-types";

/** 用户谱例：第 2 拍的两颗八分音符同时包含第一弦 0→1 和第四弦 1→2。 */
const fixture = (type: "hammerOn" | "pullOff", obstacle = false) => {
  const document = structuredClone(source);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 1);
  track.techniques = [];
  const measure = track.measures[0]!;
  measure.chordSymbols = [];
  measure.beats = Array.from({ length: 5 }, (_, i) => ({
    id: `beat-${i}`,
    tick: [0, 960, 1440, 1920, 2880][i]!,
    rhythm: { base: i === 1 || i === 2 ? "eighth" : "quarter", dots: 0 },
    kind: "notes",
    notes:
      i === 1 || i === 2
        ? [
            { id: `upper-${i}`, string: 1, fret: i - 1 },
            {
              id: `target-${i}`,
              string: 4,
              fret: type === "hammerOn" ? i : 3 - i,
            },
            ...(obstacle && i === 1
              ? [{ id: "obstacle", string: 3, fret: 12 }]
              : []),
          ]
        : [],
  }));
  const added = applyScoreCommand(document, {
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track.id,
    technique: { type, fromNoteId: "target-1", toNoteId: "target-2" },
  });
  if (!added.ok) throw new Error(JSON.stringify(added));
  return added.document;
};

/** 显式图元各自的范围才代表实际占位，不能用包含中间空白的合并矩形代替。 */
const pieces = (segment: ILXMTechniqueSegmentLayout) =>
  getTechniqueInkBounds(segment);

describe("弧线技巧的实际品位碰撞", () => {
  it.each(["hammerOn", "pullOff"] as const)(
    "%s 不会将第四弦技巧误抬到第一弦",
    (type) => {
      const document = fixture(type);
      const before = structuredClone(document);
      for (const density of ["compact", "comfortable"] as const) {
        for (const purpose of ["editing", "presentation"] as const) {
          const layout = buildLayout(document, { density, purpose });
          const segment = layout.systems[0]!.techniques[0]!;
          const notes = layout.systems[0]!.measures[0]!.notes;
          const upper = notes.filter((note) => note.string === 1);
          const target = notes.find((note) => note.id === "target-1")!;
          const coords = segment.path!.d.match(/-?(?:\d*\.)?\d+/g)!.map(Number);
          expect(segment.lane).toBe(0);
          expect(coords[0]).toBe(target.x);
          expect(coords[1]! + segment.path!.strokeWidth / 2).toBeCloseTo(
            getFretTextBounds(target).y,
            10,
          );
          expect(coords[1]).toBeGreaterThan(upper[0]!.y);
          for (const note of upper) {
            expect(
              pieces(segment).some((piece) =>
                boundsIntersect(piece, getFretTextBounds(note)),
              ),
            ).toBe(false);
          }
          // 确认测试确实覆盖“合并矩形相交、实际图元不相交”的原始误报。
          if (density === "compact")
            expect(
              upper.some((note) =>
                boundsIntersect(
                  segment.collisionBounds,
                  getFretTextBounds(note),
                ),
              ),
            ).toBe(true);
          expect(
            hitTestTechnique(layout, {
              x: (coords[0]! + coords[4]!) / 2,
              y: (coords[1]! + coords[3]!) / 2,
            }),
          ).toBe(segment.techniqueId);
        }
      }
      expect(document).toEqual(before);
      expect(document.score.tracks[0]!.techniques[0]).toMatchObject({
        fromNoteId: "target-1",
        toNoteId: "target-2",
      });
    },
  );

  it("实际文字碰撞通过局部避让解决，端点仍留在第四弦", () => {
    const layout = buildLayout(fixture("hammerOn", true), {
      density: "compact",
    });
    const segment = layout.systems[0]!.techniques[0]!;
    expect(segment.lane).toBe(0);
    const target = layout.systems[0]!.measures[0]!.notes.find(
      (n) => n.id === "target-1",
    )!;
    const y = Number(segment.path!.d.split(" ")[2]);
    expect(y + segment.path!.strokeWidth / 2).toBeCloseTo(
      getFretTextBounds(target).y,
      8,
    );
    const obstacles = layout.systems[0]!.measures[0]!.notes.filter(
      (note) => !note.id.startsWith("target-"),
    );
    for (const note of obstacles)
      expect(
        pieces(segment).some((piece) =>
          boundsIntersect(piece, getFretTextBounds(note)),
        ),
      ).toBe(false);
  });
});
