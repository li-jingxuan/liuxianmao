import { describe, expect, it } from "vitest";

import source from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import type { ILXMDocument } from "../../src/core/types";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
  hitTestTechnique,
} from "../../src/layout";
import {
  getFretTextBounds,
  getTextBounds,
} from "../../src/layout/technique-geometry";
import { LXM_TECHNIQUE_TEXT_HALO_WIDTH } from "../../src/layout/layout-constants";
import type { ILXMTechniqueSegmentLayout } from "../../src/layout/layout-types";

const curveTypes = ["tie", "hammerOn", "pullOff"] as const;
type CurveType = (typeof curveTypes)[number];
type ShortRhythm = "eighth" | "sixteenth" | "thirtySecond";

/** 真实命令构造相邻短音技巧；其余拍点填满 4/4，避免非法时值掩盖显示问题。 */
const createDocument = (
  type: CurveType,
  base: ShortRhythm,
  fret: number,
  string: number,
  measureCount: number,
): ILXMDocument => {
  const document = structuredClone(source);
  const track = document.score.tracks[0]!;
  const template = structuredClone(track.measures[1]!);
  const bases: (ShortRhythm | "quarter")[] = [
    base,
    base,
    ...(base === "sixteenth" ? ["eighth" as const] : []),
    ...(base === "thirtySecond"
      ? ["sixteenth" as const, "eighth" as const]
      : []),
    "quarter",
    "quarter",
    "quarter",
  ];
  let tick = 0;
  const durations = {
    quarter: 960,
    eighth: 480,
    sixteenth: 240,
    thirtySecond: 120,
  };
  template.chordSymbols = [];
  template.beats = bases.map((rhythm, i) => {
    const start = tick;
    tick += durations[rhythm];
    return {
      id: `curve-beat-${i}`,
      tick: start,
      rhythm: { base: rhythm, dots: 0 },
      kind: "notes",
      notes:
        i < 2
          ? [
              {
                id: `curve-note-${i}`,
                string,
                fret:
                  fret +
                  (i === 1
                    ? type === "hammerOn"
                      ? 2
                      : type === "pullOff"
                        ? -2
                        : 0
                    : 0),
              },
            ]
          : [],
    };
  });
  track.measures = Array.from({ length: measureCount }, (_, index) => {
    const measure = structuredClone(template);
    measure.id = `curve-measure-${index}`;
    if (index > 0)
      measure.beats.forEach((beat, i) => {
        beat.id = `curve-beat-${index}-${i}`;
        beat.notes = [];
      });
    return measure;
  });
  track.techniques = [];
  const result = applyScoreCommand(document, {
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track.id,
    technique: { type, fromNoteId: "curve-note-0", toNoteId: "curve-note-1" },
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.document;
};

/** 模板输出绝对二次曲线，直接检查渲染器实际消费的几何坐标。 */
const points = (segment: ILXMTechniqueSegmentLayout): number[] =>
  segment.path!.d.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)!.map(Number);

describe("技巧弧线中心锚点", () => {
  it.each(curveTypes)(
    "%s 跨行只将真实端点对齐数字中心，续接端保留谱行安全边",
    (type) => {
      const document = structuredClone(source);
      const track = document.score.tracks[0]!;
      const from = track.measures[3]!.beats.at(-1)!.notes.find(
        (note) => note.string === 6,
      )!;
      const to = track.measures[4]!.beats[0]!.notes[0]!;
      from.fret = 12;
      to.string = 6;
      to.fret = type === "hammerOn" ? 14 : type === "pullOff" ? 10 : 12;
      track.techniques = [];
      const added = applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId: track.id,
        technique: { type, fromNoteId: from.id, toNoteId: to.id },
      });
      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error(JSON.stringify(added));
      for (const density of ["compact", "comfortable"] as const) {
        const layout = buildLayout(added.document, {
          density,
          systemWidth: 742,
        });
        const segments = layout.systems.flatMap((system) => system.techniques);
        expect(segments.map((segment) => segment.continuation)).toEqual([
          "toNext",
          "fromPrevious",
        ]);
        for (const segment of segments) {
          const system = layout.systems[segment.systemIndex]!;
          const note = system.measures
            .flatMap((measure) => measure.notes)
            .find(
              (note) =>
                note.id ===
                (segment.continuation === "toNext" ? from.id : to.id),
            )!;
          const p = points(segment);
          const trueEndpoint = segment.continuation === "toNext" ? 0 : 4;
          expect(p[trueEndpoint]).toBeCloseTo(note.x, 10);
          expect(p[4]! - p[0]!).toBeGreaterThan(0);
          expect(p[1]! + segment.path!.strokeWidth / 2).toBeLessThan(
            getFretTextBounds(note).y,
          );
          if (trueEndpoint === 0) {
            expect(p[4]).toBeCloseTo(
              Math.max(
                ...system.measures.map((measure) => measure.x + measure.width),
              ) - 4,
              10,
            );
          } else {
            expect(p[0]).toBeCloseTo(system.header.staffX + 4, 10);
            expect(segment.texts).toEqual([]);
          }
          expect(segment.bounds.y).toBeGreaterThanOrEqual(system.y);
          expect(segment.bounds.y + segment.bounds.height).toBeLessThanOrEqual(
            system.y + system.height,
          );
          expect(
            hitTestTechnique(layout, {
              x: (p[0]! + p[4]!) / 2,
              y: (p[1]! + p[3]!) / 2,
            }),
          ).toBe(segment.techniqueId);
        }
      }
    },
  );

  it("中心锚点不会改变音符横坐标、小节宽度或断行", () => {
    const document = createDocument("hammerOn", "eighth", 12, 1, 8);
    const withoutTechnique = structuredClone(document);
    withoutTechnique.score.tracks[0]!.techniques = [];
    const horizontal = (input: ILXMDocument) =>
      buildLayout(input, {
        density: "compact",
        systemWidth: A4_CONTENT_WIDTH,
      }).systems.map((system) =>
        system.measures.map((measure) => ({
          id: measure.id,
          x: measure.x,
          width: measure.width,
          noteXs: measure.notes.map((note) => note.x),
        })),
      );
    expect(horizontal(document)).toEqual(horizontal(withoutTechnique));
  });

  it.each(curveTypes)(
    "%s 的密集短音弧线对齐数字中心并避开文字与描边",
    (type) => {
      for (const base of ["eighth", "sixteenth", "thirtySecond"] as const) {
        for (const density of ["compact", "comfortable"] as const) {
          for (const [fret, string, measureCount] of [
            [12, 3, 8],
            [3, 1, 1],
            [24, 6, 8],
          ] as const) {
            // 击弦起点 22 品，使终点最高仍为合法的 24 品。
            const document = createDocument(
              type,
              base,
              type === "hammerOn" && fret === 24 ? 22 : fret,
              string,
              measureCount,
            );
            const before = structuredClone(document);
            for (const purpose of ["editing", "presentation"] as const) {
              const layout = buildLayout(document, {
                purpose,
                density,
                systemWidth: A4_CONTENT_WIDTH,
              });
              const segment = layout.systems[0]!.techniques[0]!;
              const notes = layout.systems[0]!.measures[0]!.notes;
              const [from, to] = ["curve-note-0", "curve-note-1"].map(
                (id) => notes.find((note) => note.id === id)!,
              );
              const p = points(segment);
              expect(
                p[4]! - p[0]!,
                `${type} ${base} ${density} 弧线不能退化`,
              ).toBeGreaterThan(0);
              expect(p[0]).toBeCloseTo(from!.x, 10);
              expect(p[4]).toBeCloseTo(to!.x, 10);
              for (const note of [from!, to!]) {
                expect(p[1]! + segment.path!.strokeWidth / 2).toBeLessThan(
                  getFretTextBounds(note).y,
                );
              }
              // H/P 文字连同白色描边须完整高于弧线控制点包围框。
              if (type !== "tie") {
                const label = getTextBounds(
                  segment.texts[0]!,
                  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
                );
                expect(segment.texts[0]!.x).toBeCloseTo(
                  (from!.x + to!.x) / 2,
                  10,
                );
                expect(label.y + label.height).toBeLessThan(
                  p[3]! - segment.path!.strokeWidth / 2,
                );
              }
              const midpoint = {
                x: (p[0]! + p[4]!) / 2,
                y: (p[1]! + p[3]!) / 2,
              };
              expect(hitTestTechnique(layout, midpoint)).toBe(
                segment.techniqueId,
              );
            }
            expect(document).toEqual(before);
          }
        }
      }
    },
  );
});
