import { describe, expect, it } from "vitest";
import score from "../../example/example-technique-rhythm";
import {
  LXM_RHYTHM_BASES,
  LXM_TECHNIQUE_TYPES,
} from "../../src/core/constants";
import { loadDocument } from "../../src/core/loader";
import { buildLayout, hitTestTechnique } from "../../src/layout";

describe("常用技巧与时值规范测试谱", () => {
  it("正式 loader 接受完整 14 小节，覆盖全部技巧、时值、附点、休止与三连音", () => {
    const loaded = loadDocument(JSON.stringify(score));
    expect(loaded.ok).toBe(true);
    const track = score.score.tracks[0]!;
    expect(track.measures).toHaveLength(14);
    expect(new Set(track.techniques.map((t) => t.type))).toEqual(
      new Set(LXM_TECHNIQUE_TYPES),
    );
    const beats = track.measures.flatMap((m) => m.beats);
    expect(new Set(beats.map((b) => b.rhythm.base))).toEqual(
      new Set(LXM_RHYTHM_BASES),
    );
    expect(new Set(beats.map((b) => b.rhythm.dots))).toEqual(
      new Set([0, 1, 2]),
    );
    expect(beats.some((b) => b.kind === "rest")).toBe(true);
    expect(track.measures.some((m) => m.tuplets.length > 0)).toBe(true);
  });

  it.each(["compact", "comfortable"] as const)(
    "%s 密度下重排后所有技巧完整且不改文档",
    (density) => {
      const before = structuredClone(score);
      for (const systemWidth of [300, 733]) {
        const layout = buildLayout(score, { density, systemWidth });
        const allSegments = layout.systems.flatMap((s) => s.techniques);
        expect(new Set(allSegments.map((s) => s.techniqueId))).toEqual(
          new Set(score.score.tracks[0]!.techniques.map((t) => t.id)),
        );
        for (const system of layout.systems) {
          for (const segment of system.techniques) {
            expect(segment.visualBounds.x).toBeGreaterThanOrEqual(system.x);
            expect(
              segment.visualBounds.x + segment.visualBounds.width,
            ).toBeLessThanOrEqual(system.x + system.width + 1e-8);
            expect(segment.visualBounds.y).toBeGreaterThanOrEqual(
              system.y - 1e-8,
            );
            expect(
              segment.visualBounds.y + segment.visualBounds.height,
            ).toBeLessThanOrEqual(system.y + system.height + 1e-8);
          }
        }
        const natural = allSegments.find((s) => s.type === "naturalHarmonic")!;
        expect(
          hitTestTechnique(layout, {
            x: natural.bounds.x + natural.bounds.width / 2,
            y: natural.bounds.y + natural.bounds.height / 2,
          }),
        ).toBe(natural.techniqueId);
        expect(JSON.stringify(layout)).not.toMatch(/NaN|Infinity/);
        expect(buildLayout(score, { density, systemWidth })).toEqual(layout);
      }
      expect(score).toEqual(before);
    },
  );
});
