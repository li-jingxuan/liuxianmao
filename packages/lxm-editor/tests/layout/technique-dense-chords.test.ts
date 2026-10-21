import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import {
  screenshot,
  chordPair,
  fourthStringScreenshot,
} from "../fixtures/technique-dense-chords";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
  hitTestTechnique,
} from "../../src/layout";
import {
  boundsIntersect,
  getTechniqueInkBounds,
  getFretTextBounds,
} from "../../src/layout/technique-geometry";

describe("完整密集和弦谱中的多条弧线", () => {
  it.each([false, true])(
    "添加顺序 reverse=%s 不会把弧线搬到其他弦",
    (reverse) => {
      const document = screenshot(reverse);
      const layout = buildLayout(document, {
        density: "compact",
        purpose: "editing",
        systemWidth: A4_CONTENT_WIDTH,
      });
      for (const technique of document.score.tracks[0]!.techniques.filter(
        (t) =>
          t.type === "hammerOn" &&
          document.score.tracks[0]!.measures[6]!.beats.some((b) =>
            b.notes.some((n) => n.id === t.fromNoteId),
          ),
      )) {
        if (!("fromNoteId" in technique)) continue;
        const system = layout.systems.find((s) =>
          s.techniques.some((t) => t.techniqueId === technique.id),
        )!;
        const segment = system.techniques.find(
          (t) => t.techniqueId === technique.id,
        )!;
        const note = system.measures
          .flatMap((m) => m.notes)
          .find((n) => n.id === technique.fromNoteId)!;
        const p = segment.path!.d.match(/-?(?:\d*\.)?\d+/g)!.map(Number);
        expect(
          p[1]! + segment.path!.strokeWidth / 2,
          `${note.string}弦 ${technique.id}`,
        ).toBeCloseTo(getFretTextBounds(note).y, 8);
      }
    },
  );
});

const stringPairs = Array.from({ length: 6 }, (_, i) => i + 1).flatMap((a) =>
  Array.from({ length: 6 - a }, (_, i) => [a, a + i + 1]),
);
describe("同拍多弦技巧组合", () => {
  for (const type of ["hammerOn", "pullOff", "tie"] as const) {
    it.each(
      [...stringPairs, [1, 2, 3, 4, 5, 6]].flatMap((strings) =>
        [false, true].map((twoDigits) => [strings, twoDigits] as const),
      ),
    )(`${type} %s 弦，双位=%s`, (strings, twoDigits) => {
      const document = chordPair([...strings], type, twoDigits);
      for (const density of ["compact", "comfortable"] as const) {
        for (const purpose of ["editing", "presentation"] as const) {
          const layout = buildLayout(document, {
            density,
            purpose,
            systemWidth: A4_CONTENT_WIDTH,
          });
          const system = layout.systems.find((s) =>
            s.measures.some((m) => m.id === "mvp72-measure-7"),
          )!;
          // 通过领域技巧 ID 取几何，既检查弦归属，也检查实际可见图元。
          for (const t of document.score.tracks[0]!.techniques.filter(
            (t) => "fromNoteId" in t && t.fromNoteId.startsWith("chord-"),
          )) {
            if (!("fromNoteId" in t)) continue;
            const segment = system.techniques.find(
              (s) => s.techniqueId === t.id,
            )!;
            const note = system.measures
              .flatMap((m) => m.notes)
              .find((n) => n.id === t.fromNoteId)!;
            const coords = segment
              .path!.d.match(/-?(?:\d*\.)?\d+/g)!
              .map(Number);
            expect(coords[1]! + segment.path!.strokeWidth / 2).toBeCloseTo(
              getFretTextBounds(note).y,
              8,
            );
            const otherNotes = system.measures
              .flatMap((m) => m.notes)
              .filter(
                (n) =>
                  n.id !== t.fromNoteId &&
                  "toNoteId" in t &&
                  n.id !== t.toNoteId,
              );
            for (const n of otherNotes) {
              expect(
                getTechniqueInkBounds(segment).some((piece) =>
                  boundsIntersect(piece, getFretTextBounds(n)),
                ),
                `碰到 ${n.id}`,
              ).toBe(false);
            }
            for (const other of system.techniques.filter(
              (s) => s.techniqueId !== segment.techniqueId,
            )) {
              expect(
                getTechniqueInkBounds(segment).some((a) =>
                  getTechniqueInkBounds(other).some((b) =>
                    boundsIntersect(a, b),
                  ),
                ),
                `碰到技巧 ${other.techniqueId}`,
              ).toBe(false);
            }
            if (segment.texts[0]) {
              const label = segment.texts[0];
              expect(
                hitTestTechnique(layout, {
                  x: label.x,
                  y: label.y - label.fontSize / 2,
                }),
              ).toBe(segment.techniqueId);
            }
          }
        }
      }
    });
  }
});

/** 同一技巧集合必须与命令插入顺序无关，防止按技巧 ID 抢占避让层。 */
it("反向添加得到相同的最终几何", () => {
  const shape = (reverse: boolean) => {
    const document = screenshot(reverse);
    const layout = buildLayout(document, {
      density: "compact",
      systemWidth: A4_CONTENT_WIDTH,
    });
    const track = document.score.tracks[0]!;
    return track.techniques
      .flatMap((t) => {
        if (!("fromNoteId" in t)) return [];
        const segment = layout.systems
          .flatMap((s) => s.techniques)
          .find((s) => s.techniqueId === t.id)!;
        return [
          { from: t.fromNoteId, path: segment.path, texts: segment.texts },
        ];
      })
      .sort((a, b) => a.from.localeCompare(b.from));
  };
  expect(shape(false)).toEqual(shape(true));
});

it("同弦连续 H 共享端点时仍保留两条完整弧线", () => {
  const document = chordPair([2, 5], "hammerOn");
  const track = document.score.tracks[0]!;
  track.measures[6]!.beats[2]!.notes = [
    { id: "chain-end", string: 5, fret: 6 },
  ];
  const added = applyScoreCommand(document, {
    type: LXMScoreCommandEnum.AddTechnique,
    trackId: track.id,
    technique: {
      type: "hammerOn",
      fromNoteId: "chord-1-5",
      toNoteId: "chain-end",
    },
  });
  if (!added.ok) throw new Error(JSON.stringify(added));
  const layout = buildLayout(added.document, { density: "comfortable" });
  const last = layout.systems
    .flatMap((s) => s.techniques)
    .find(
      (s) =>
        s.techniqueId === added.document.score.tracks[0]!.techniques.at(-1)!.id,
    )!;
  expect(last.texts[0]!.fontSize).toBe(9);
  expect(last.path!.d.match(/M/g)).toHaveLength(1);
});

/** 上一张完整截图以及纯 TAB 的另一套间距算法必须一起通过。 */
it.each(["compact", "comfortable"] as const)(
  "%s 上一张截图和纯 TAB 不再错弦",
  (density) => {
    for (const purpose of ["editing", "presentation"] as const) {
      for (const document of [
        fourthStringScreenshot(),
        chordPair([1, 2, 3, 4, 5, 6], "hammerOn", true),
      ]) {
        // 清除简谱触发独立 TAB 节奏列流程；保留和弦、歌词和其它技巧。
        if (
          document.score.tracks[0]!.measures[6]!.beats[0]!.notes.length === 6
        ) {
          document.score.tracks[0]!.measures.forEach((m) => {
            m.numberedVoice.events = [];
          });
          document.score.tracks[0]!.numberedMarks = [];
        }
        const before = structuredClone(document);
        const layout = buildLayout(document, {
          density,
          purpose,
          systemWidth: 320,
        });
        const track = document.score.tracks[0]!;
        const ids = new Set(
          track.measures[6]!.beats.flatMap((b) => b.notes.map((n) => n.id)),
        );
        for (const t of track.techniques) {
          if (!("fromNoteId" in t) || !ids.has(t.fromNoteId)) continue;
          const system = layout.systems.find((s) =>
            s.techniques.some((seg) => seg.techniqueId === t.id),
          )!;
          const segment = system.techniques.find(
            (seg) => seg.techniqueId === t.id,
          )!;
          const note = system.measures
            .flatMap((m) => m.notes)
            .find((n) => n.id === t.fromNoteId)!;
          expect(
            Number(segment.path!.d.split(" ")[2]) +
              segment.path!.strokeWidth / 2,
          ).toBeCloseTo(getFretTextBounds(note).y, 8);
          const pieces = getTechniqueInkBounds(segment);
          for (const n of system.measures
            .flatMap((m) => m.notes)
            .filter(
              (n) =>
                n.id !== t.fromNoteId && "toNoteId" in t && n.id !== t.toNoteId,
            ))
            expect(
              pieces.some((p) => boundsIntersect(p, getFretTextBounds(n))),
            ).toBe(false);
        }
        expect(document).toEqual(before);
      }
    }
  },
);

it("延音线与 H 混用按真实弦位布置，不按标签包围框抢占位置", () => {
  const document = chordPair([1, 2], "hammerOn", true);
  const track = document.score.tracks[0]!;
  track.techniques = track.techniques.filter(
    (t) => !("fromNoteId" in t && t.fromNoteId.startsWith("chord-")),
  );
  track.measures[6]!.beats[1]!.notes.find((n) => n.string === 1)!.fret = 12;
  let current = document;
  for (const [string, type] of [
    [1, "tie"],
    [2, "hammerOn"],
  ] as const) {
    const added = applyScoreCommand(current, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId: track.id,
      technique: {
        type,
        fromNoteId: `chord-0-${string}`,
        toNoteId: `chord-1-${string}`,
      },
    });
    if (!added.ok) throw new Error(JSON.stringify(added));
    current = added.document;
  }
  const layout = buildLayout(current, {
    density: "compact",
    systemWidth: A4_CONTENT_WIDTH,
  });
  const hammer = layout.systems
    .flatMap((s) => s.techniques)
    .find(
      (s) => s.techniqueId === current.score.tracks[0]!.techniques.at(-1)!.id,
    )!;
  const tie = layout.systems
    .flatMap((s) => s.techniques)
    .find(
      (s) => s.techniqueId === current.score.tracks[0]!.techniques.at(-2)!.id,
    )!;
  const points = tie.path!.d.match(/-?(?:\d*\.)?\d+/g)!.map(Number);
  // 正常平行连接不应因下方 H 抢先占位而拉成跨弦的大拱形。
  expect(Math.abs(points[1]! - points[3]!)).toBeLessThanOrEqual(6);
  expect(
    getTechniqueInkBounds(tie).some((a) =>
      getTechniqueInkBounds(hammer).some((b) => boundsIntersect(a, b)),
    ),
  ).toBe(false);
});
