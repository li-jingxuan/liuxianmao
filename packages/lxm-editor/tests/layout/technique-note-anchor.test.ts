import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import type { ILXMTechnique } from "../../src/core/types";
import { buildLayout, hitTestTechnique } from "../../src/layout";
import {
  LXM_TECHNIQUE_CURVE_HEIGHT,
  LXM_TECHNIQUE_FRET_GAP_X,
  LXM_TECHNIQUE_LANE_HEIGHT,
  LXM_TECHNIQUE_NOTE_CLEARANCE_Y,
} from "../../src/layout/layout-constants";
import {
  boundsIntersect,
  getFretTextBounds,
} from "../../src/layout/technique-geometry";
import type { ILXMTechniqueSegmentLayout } from "../../src/layout/layout-types";

const createDocument = (string = 6) => {
  const document = structuredClone(EXAMPLE_MVP_2);
  const track = document.score.tracks[0]!;
  // 两个单音 Beat 与尾部合法节奏足够复现锚点问题，移除无关小节与和弦障碍。
  track.measures = track.measures.slice(0, 1);
  track.measures[0]!.beats.forEach((beat, index) => {
    beat.notes =
      index < 2 ? [{ id: `anchor-note-${index}`, string, fret: 12 }] : [];
  });
  track.techniques = [];
  return document;
};

const createTechnique = (
  type: string,
  id = `anchor-${type}`,
): ILXMTechnique => {
  if (["tie", "hammerOn", "pullOff"].includes(type)) {
    return {
      id,
      type,
      fromNoteId: "anchor-note-0",
      toNoteId: "anchor-note-1",
    } as ILXMTechnique;
  }
  if (type === "pickStroke")
    return {
      id,
      type,
      beatId: "mvp2-beat-1-1",
      stroke: "down",
    };
  if (type === "trill")
    return { id, type, fromNoteId: "anchor-note-0", auxiliaryFret: 14 };
  if (type === "bend")
    return {
      id,
      type,
      fromNoteId: "anchor-note-0",
      semitones: 2,
    } as ILXMTechnique;
  return { id, type, fromNoteId: "anchor-note-0" } as ILXMTechnique;
};

const pathCoordinates = (segment: ILXMTechniqueSegmentLayout): number[] =>
  (segment.path?.d.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);

const getAnchorY = (segment: ILXMTechniqueSegmentLayout) =>
  segment.path ? pathCoordinates(segment)[1]! : segment.texts[0]!.y;

const types = [
  "tie",
  "hammerOn",
  "pullOff",
  "bend",
  "vibrato",
  "tapping",
  "trill",
  "pickStroke",
];

describe("技巧的音符自然锚点", () => {
  it.each(["palmMute", "letRing"] as const)(
    "%s 完整标记高于第一弦品位及描边",
    (type) => {
      const document = createDocument(1);
      document.score.tracks[0]!.techniques = [
        {
          id: "staff-above",
          type,
          fromBeatId: "mvp2-beat-1-1",
          toBeatId: "mvp2-beat-1-2",
        },
      ];
      const layout = buildLayout(document);
      const segment = layout.systems[0]!.techniques[0]!;
      const noteBounds = getFretTextBounds(
        layout.systems[0]!.measures[0]!.notes[0]!,
      );
      expect(segment.visualBounds.y + segment.visualBounds.height).toBeLessThan(
        noteBounds.y,
      );
    },
  );
  it.each(types)("%s 在第一弦和第六弦上保持相同的自然净空", (type) => {
    const offsets = [1, 6].map((string) => {
      const document = createDocument(string);
      document.score.tracks[0]!.techniques = [createTechnique(type)];
      const layout = buildLayout(document);
      const target = layout.systems[0]!.measures[0]!.notes.find(
        (note) => note.id === "anchor-note-0",
      )!;
      const segment = layout.systems[0]!.techniques[0]!;
      expect(segment.lane).toBe(0);
      expect(segment.bounds.y).toBeGreaterThanOrEqual(layout.systems[0]!.y);
      return target.y - getAnchorY(segment);
    });
    expect(offsets[0]).toBeCloseTo(offsets[1]!, 10);
    expect(offsets[0]).toBeGreaterThan(0);
    expect(offsets[0]).toBeLessThanOrEqual(LXM_TECHNIQUE_NOTE_CLEARANCE_Y + 3);
  });

  it.each([3, 12])("Tie 的 %i 品位端点避开完整文字和描边", (fret) => {
    const document = createDocument();
    document.score.tracks[0]!.measures[0]!.beats.forEach((beat) =>
      beat.notes.forEach((note) => {
        note.fret = fret;
      }),
    );
    document.score.tracks[0]!.techniques = [createTechnique("tie")];
    const layout = buildLayout(document);
    const notes = layout.systems[0]!.measures[0]!.notes;
    const from = getFretTextBounds(notes[0]!);
    const to = getFretTextBounds(notes[1]!);
    const points = pathCoordinates(layout.systems[0]!.techniques[0]!);
    expect(points[0]).toBeCloseTo(
      from.x + from.width + LXM_TECHNIQUE_FRET_GAP_X,
      10,
    );
    expect(points[4]).toBeCloseTo(to.x - LXM_TECHNIQUE_FRET_GAP_X, 10);
    expect(points[1]).toBe(notes[0]!.y - LXM_TECHNIQUE_NOTE_CLEARANCE_Y);
    expect(points[3]).toBe(points[1]! - LXM_TECHNIQUE_CURVE_HEIGHT);
  });

  it("同一锚点的两个波浪线整体向上避让", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      createTechnique("vibrato", "a"),
      createTechnique("vibrato", "b"),
    ];
    const segments = buildLayout(document).systems[0]!.techniques;
    expect(segments.map((segment) => segment.lane)).toEqual([0, 1]);
    expect(getAnchorY(segments[1]!)).toBe(
      getAnchorY(segments[0]!) - LXM_TECHNIQUE_LANE_HEIGHT,
    );
    expect(
      boundsIntersect(
        segments[0]!.collisionBounds,
        segments[1]!.collisionBounds,
      ),
    ).toBe(false);
  });

  it("不同弦上 Y 不相交的图形复用 lane 0，相邻弦碰撞仍被检测", () => {
    const document = createDocument();
    const beat = document.score.tracks[0]!.measures[0]!.beats[0]!;
    beat.notes.push({ id: "upper-note", string: 1, fret: 7 });
    document.score.tracks[0]!.techniques = [
      createTechnique("tapping"),
      {
        id: "upper-tapping",
        type: "tapping",
        fromNoteId: "upper-note",
      },
    ];
    const separated = buildLayout(document).systems[0]!.techniques;
    expect(separated.map((segment) => segment.lane)).toEqual([0, 0]);
    beat.notes[1]!.string = 5;
    const adjacent = buildLayout(document).systems[0]!.techniques;
    expect(
      boundsIntersect(
        adjacent[0]!.collisionBounds,
        adjacent[1]!.collisionBounds,
      ),
    ).toBe(false);
    expect(adjacent.some((segment) => segment.lane > 0)).toBe(true);
  });

  it("音符局部技巧避开水平范围内的其他品位文字", () => {
    const document = createDocument();
    document.score.tracks[0]!.measures[0]!.beats[0]!.notes.push({
      id: "obstacle",
      string: 5,
      fret: 24,
    });
    document.score.tracks[0]!.techniques = [createTechnique("tapping")];
    const layout = buildLayout(document);
    const segment = layout.systems[0]!.techniques[0]!;
    const obstacle = layout.systems[0]!.measures[0]!.notes.find(
      (note) => note.id === "obstacle",
    )!;
    expect(segment.lane).toBeGreaterThan(0);
    expect(
      boundsIntersect(segment.collisionBounds, getFretTextBounds(obstacle)),
    ).toBe(false);
  });

  it.each(["compact", "comfortable"] as const)(
    "%s 跨行 Tie 的两端跟随本行音符，且命中仍指向同一技巧",
    (density) => {
      const document = structuredClone(EXAMPLE_MVP_2);
      document.score.tracks[0]!.techniques = [
        {
          id: "cross-anchor",
          type: "tie",
          fromNoteId: "mvp2-note-4-6-6",
          toNoteId: "mvp2-note-5-1-6",
        },
      ];
      const layout = buildLayout(document, { systemWidth: 742, density });
      const segments = layout.systems.flatMap((system) => system.techniques);
      const notes = layout.systems.flatMap((system) =>
        system.measures.flatMap((measure) => measure.notes),
      );
      for (const segment of segments) {
        const noteId =
          segment.continuation === "toNext"
            ? "mvp2-note-4-6-6"
            : "mvp2-note-5-1-6";
        const note = notes.find((candidate) => candidate.id === noteId)!;
        expect(getAnchorY(segment)).toBeCloseTo(
          note.y -
            LXM_TECHNIQUE_NOTE_CLEARANCE_Y -
            segment.lane * LXM_TECHNIQUE_LANE_HEIGHT,
          10,
        );
        expect(
          hitTestTechnique(layout, {
            x: segment.bounds.x + segment.bounds.width / 2,
            y: segment.bounds.y + segment.bounds.height / 2,
          }),
        ).toBe("cross-anchor");
      }
      expect(segments.map((segment) => segment.continuation)).toEqual([
        "toNext",
        "fromPrevious",
      ]);
    },
  );

  it("重叠技巧扩高后仍完整落在 system 内，且布局确定、文档不变", () => {
    const document = createDocument(1);
    document.score.tracks[0]!.techniques = types.map((type) =>
      createTechnique(type),
    );
    const before = structuredClone(document);
    const layout = buildLayout(document);
    for (const system of layout.systems) {
      for (const segment of system.techniques) {
        expect(segment.bounds.y).toBeGreaterThanOrEqual(system.y - 1e-10);
        expect(segment.bounds.y + segment.bounds.height).toBeLessThanOrEqual(
          system.y + system.height,
        );
        expect(segment.collisionBounds.x).toBeLessThanOrEqual(
          segment.visualBounds.x,
        );
        expect(segment.collisionBounds.y).toBeLessThanOrEqual(
          segment.visualBounds.y,
        );
      }
    }
    expect(layout).toEqual(buildLayout(document));
    expect(document).toEqual(before);
  });

  it("没有技巧时保持完整的既有 system 几何", () => {
    const document = createDocument();
    const baseline = buildLayout(document);
    document.score.tracks[0]!.techniques = [
      { id: "harmonic", type: "naturalHarmonic", fromNoteId: "anchor-note-0" },
    ];
    const layout = buildLayout(document);
    const withoutTechniques = layout.systems.map((system) => ({
      ...system,
      techniques: [],
    }));
    expect(withoutTechniques).toEqual(baseline.systems);
  });

  it("推弦避让时路径、Full 标签、箭头范围和命中整体平移", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      createTechnique("bend", "a"),
      createTechnique("bend", "b"),
    ];
    const segments = buildLayout(document).systems[0]!.techniques;
    const first = segments[0]!;
    const second = segments[1]!;
    const dy = -second.lane * LXM_TECHNIQUE_LANE_HEIGHT;
    expect(getAnchorY(second)).toBe(getAnchorY(first) + dy);
    expect(second.texts[0]!.y).toBe(first.texts[0]!.y + dy);
    expect(second.bounds.y).toBe(first.bounds.y + dy);
    expect(second.visualBounds.y).toBe(first.visualBounds.y + dy);
    const coords = pathCoordinates(first);
    // 箭头外延与 Full 标签都包含在完整可见范围内。
    expect(first.visualBounds.x + first.visualBounds.width).toBeGreaterThan(
      coords[4]!,
    );
    expect(first.visualBounds.y).toBeLessThan(coords[5]!);
    expect(boundsIntersect(first.collisionBounds, second.collisionBounds)).toBe(
      false,
    );
  });

  it("极短连接不输出反向弧线或非有限坐标", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [createTechnique("tie")];
    const layout = buildLayout(document, {
      systemWidth: 90,
      density: "compact",
    });
    const coords = pathCoordinates(layout.systems[0]!.techniques[0]!);
    expect(coords[4]).toBeGreaterThanOrEqual(coords[0]!);
    expect(coords.every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(layout)).not.toMatch(/NaN|Infinity/);
  });

  it("跨行滑音只使用本行弦线和安全边，不重复输出跨页面路径", () => {
    const document = structuredClone(EXAMPLE_MVP_2);
    document.score.tracks[0]!.techniques = [
      {
        id: "cross-slide",
        type: "slideUp",
        fromNoteId: "mvp2-note-1-1-6",
        toNoteId: "mvp2-note-8-1-6",
      },
    ];
    const layout = buildLayout(document, {
      systemWidth: 350,
      density: "compact",
    });
    const segments = layout.systems.flatMap((system) => system.techniques);
    expect(segments.length).toBeGreaterThan(2);
    for (const segment of segments) {
      const system = layout.systems[segment.systemIndex]!;
      const coords = pathCoordinates(segment);
      const stringY = system.measures[0]!.strings.find(
        (string) => string.index === 6,
      )!.y1;
      expect(coords[1]).toBe(stringY);
      expect(coords[3]).toBe(stringY);
      expect(segment.bounds.y).toBeGreaterThan(system.y);
      expect(segment.bounds.y + segment.bounds.height).toBeLessThan(
        system.y + system.height,
      );
    }
  });
});
