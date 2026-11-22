import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import type { ILXMTechnique } from "../../src/core/types";
import {
  buildLayout,
  hitTestTechnique,
  hitTestTechniqueTarget,
} from "../../src/layout";
import {
  LXM_DURATION_STEM_NOTE_GAP,
  LXM_TECHNIQUE_ARROW_OFFSET_Y,
  LXM_TECHNIQUE_CURVE_INK_GAP,
  LXM_TECHNIQUE_PATH_STROKE_WIDTH,
} from "../../src/layout/layout-constants";
import { techniqueInkIntersects } from "../../src/layout/techniques/technique-curve-placement";
import { getFretTextBounds, getTechniqueInkBounds } from "../../src/layout/techniques/technique-geometry";
import { buildScoreScene } from "../../src/presentation/score-scene";

const createDocument = () => structuredClone(EXAMPLE_MVP_2);

describe("MVP v5 技巧布局", () => {
  it("扫弦记号横向中心与目标 Beat 的 Note 中心重合", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-centered-strum",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      } as ILXMTechnique,
    ];
    const baseline = buildLayout(createDocument());
    const expectedX = baseline.systems
      .flatMap((system) => system.measures)
      .flatMap((measure) => measure.notes)
      .find((note) => note.beatId === "mvp2-beat-1-2")!.x;

    const segment = buildLayout(document).systems
      .flatMap((system) => system.techniques)
      .find((technique) => technique.techniqueId === "tech-centered-strum")!;
    expect(segment.path?.d).toMatch(new RegExp(`M ${expectedX} `));
  });

  it.each(["down", "up"] as const)("扫弦模板 %s 保留品位，箭头在数字左侧且方向正确", (stroke) => {
    const document = createDocument();
    const id = "mvp2-beat-1-2";
    document.score.tracks[0]!.techniques = [
      { id: "strum-template", type: "strum", beatId: id, minString: 2, maxString: 3, stroke, showFrets: true },
    ];
    const layout = buildLayout(document);
    const notes = layout.systems.flatMap((system) => system.measures.flatMap((measure) => measure.notes))
      .filter((note) => note.beatId === id);
    const segment = layout.systems.flatMap((system) => system.techniques).find((mark) => mark.techniqueId === "strum-template")!;
    expect(notes).toHaveLength(2);
    expect(segment.visualBounds.x + segment.visualBounds.width).toBeLessThan(notes[0]!.x);
    const [start, end] = segment.path!.d.match(/-?\d+(?:\.\d+)?/g)!.filter((_, index) => index % 2).map(Number);
    expect(Math.sign(end! - start!)).toBe(stroke === "down" ? -1 : 1);
  });

  it("扫弦只覆盖用户选择的最小到最大弦范围", () => {
    const document = createDocument();
    const targetBeat = document.score.tracks[0]!.measures[0]!.beats[1]!;
    targetBeat.notes.push({ id: "note-outside-strum-range", string: 6, fret: 5 });
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-selected-string-range",
        type: "strum",
        beatId: targetBeat.id,
        minString: 2,
        maxString: 3,
        stroke: "down",
      } as ILXMTechnique,
    ];

    const layout = buildLayout(document);
    const notes = layout.systems.flatMap((system) =>
      system.measures.flatMap((measure) => measure.notes),
    );
    const visibleTargetStrings = notes
      .filter((note) => note.beatId === targetBeat.id)
      .map((note) => note.string);

    expect(visibleTargetStrings).toEqual([6]);
  });

  it.each([
    {
      label: "扫弦",
      technique: {
        id: "tech-stem-anchor-strum",
        type: "strum" as const,
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 6,
        stroke: "down" as const,
      },
      bottomOffset: 0,
    },
    {
      label: "上行琶音",
      technique: {
        id: "tech-stem-anchor-arpeggio-ascending",
        type: "arpeggio" as const,
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 6,
        direction: "ascending" as const,
      },
      bottomOffset: 0,
    },
    {
      label: "下行琶音",
      technique: {
        id: "tech-stem-anchor-arpeggio-descending",
        type: "arpeggio" as const,
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 6,
        direction: "descending" as const,
      },
      // 下行琶音的显式箭头越过最下方弦线，符干必须同步避让这段几何。
      bottomOffset: LXM_TECHNIQUE_ARROW_OFFSET_Y,
    },
  ])(
    "$label 范围低于最低 Note 时，符干避开技巧最下方可见几何",
    ({ technique, bottomOffset }) => {
      const document = createDocument();
      document.score.tracks[0]!.techniques = [technique];

      const layout = buildLayout(document);
      const measure = layout.systems
        .flatMap((system) => system.measures)
        .find((candidate) => candidate.id === "mvp2-measure-1")!;
      const mark = measure.durationMarks.find(
        (candidate) => candidate.beatId === "mvp2-beat-1-2",
      )!;
      const string6Y = measure.strings.find(
        (string) => string.index === 6,
      )!.y1;

      expect(mark.stemY1).toBe(
        string6Y + LXM_DURATION_STEM_NOTE_GAP + bottomOffset,
      );
      const segment = layout.systems
        .flatMap((system) => system.techniques)
        .find((candidate) => candidate.techniqueId === technique.id)!;
      const arrowBottomY = Math.max(
        ...(segment.arrowHead?.points.map(([, y]) => y) ?? [-Infinity]),
      );
      expect(mark.stemY1).toBeGreaterThan(arrowBottomY);
    },
  );

  it.each(["ascending", "descending"] as const)(
    "琶音 %s 使用垂直居中的显式箭头，而不是自动旋转 marker",
    (direction) => {
      const document = createDocument();
      document.score.tracks[0]!.techniques = [
        {
          id: `tech-arrow-${direction}`,
          type: "arpeggio",
          beatId: "mvp2-beat-1-2",
          minString: 2,
          maxString: 6,
          direction,
        },
      ];

      const segment = buildLayout(document).systems
        .flatMap((system) => system.techniques)
        .find((technique) => technique.type === "arpeggio")!;
      expect(segment.path?.markerEnd).toBeUndefined();
      expect(segment.arrowHead?.points).toHaveLength(3);
      const [tip, left, right] = segment.arrowHead!.points;
      expect(tip![0]).toBe(left![0] + (right![0] - left![0]) / 2);
      expect(left![1]).toBe(right![1]);
      expect(direction === "ascending" ? tip![1] < left![1] : tip![1] > left![1]).toBe(true);
      expect(
        hitTestTechniqueTarget(buildLayout(document), {
          x: tip![0],
          y: tip![1],
        }),
      ).toMatchObject({
        techniqueId: `tech-arrow-${direction}`,
        focusEndpoint: "end",
      });
    },
  );

  it("没有扫弦或琶音时 duration mark 保持原布局结果", () => {
    const document = createDocument();
    const baseline = buildLayout(document);
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-unrelated-harmonic",
        type: "naturalHarmonic",
        fromNoteId: "mvp2-note-1-1-6",
      },
    ];
    const withUnrelatedTechnique = buildLayout(document);
    const getDurationMarks = (layout: ReturnType<typeof buildLayout>) =>
      layout.systems.flatMap((system) =>
        system.measures.flatMap((measure) => measure.durationMarks),
      );
    expect(getDurationMarks(withUnrelatedTechnique)).toEqual(
      getDurationMarks(baseline),
    );
  });

  it.each([
    {
      type: "strum" as const,
      technique: {
        id: "tech-projection-strum",
        type: "strum" as const,
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down" as const,
      },
    },
    {
      type: "arpeggio" as const,
      technique: {
        id: "tech-projection-arpeggio",
        type: "arpeggio" as const,
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        direction: "ascending" as const,
      },
    },
  ])("$type 隐藏基础品位布局但完整保留源 Note", ({ technique }) => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [technique];
    const sourceBeforeLayout = structuredClone(document);

    const layout = buildLayout(document, { systemWidth: 742 });
    const notes = layout.systems.flatMap((system) =>
      system.measures.flatMap((measure) => measure.notes),
    );

    expect(notes.some((note) => note.beatId === technique.beatId)).toBe(false);
    expect(notes.some((note) => note.beatId === "mvp2-beat-1-1")).toBe(true);
    expect(document).toEqual(sourceBeforeLayout);
    expect(
      document.score.tracks[0]!.measures[0]!.beats[1]!.notes,
    ).toHaveLength(2);
  });

  it("移除扫弦后无需恢复数据，下一次布局自然重新显示原品位", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-remove-projection",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      },
    ];
    const hidden = buildLayout(document);
    document.score.tracks[0]!.techniques = [];
    const restored = buildLayout(document);
    const getTargetNotes = (layout: ReturnType<typeof buildLayout>) =>
      layout.systems.flatMap((system) =>
        system.measures.flatMap((measure) =>
          measure.notes.filter((note) => note.beatId === "mvp2-beat-1-2"),
        ),
      );

    expect(getTargetNotes(hidden)).toHaveLength(0);
    expect(getTargetNotes(restored)).toHaveLength(2);
  });

  it("只隐藏基础品位，仍保留同 Beat 上泛音技巧自己的记谱文本", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-strum-with-harmonic",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      },
      {
        id: "tech-harmonic-on-hidden-note",
        type: "naturalHarmonic",
        fromNoteId: "mvp2-note-1-2-3",
      },
    ];

    const layout = buildLayout(document);
    const techniques = layout.systems.flatMap((system) => system.techniques);
    const notes = layout.systems.flatMap((system) =>
      system.measures.flatMap((measure) => measure.notes),
    );

    expect(notes.some((note) => note.beatId === "mvp2-beat-1-2")).toBe(false);
    expect(
      techniques.find(
        (technique) => technique.techniqueId === "tech-harmonic-on-hidden-note",
      )?.texts[0]?.text,
    ).toBe("<3>");
  });

  it("非法的单音 strum 安全降级：保留品位且不输出非法 segment", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-invalid-single-note-strum",
        type: "strum",
        beatId: "mvp2-beat-1-1",
        minString: 1,
        maxString: 1,
        stroke: "down",
      },
    ];

    const layout = buildLayout(document);
    const techniques = layout.systems.flatMap((system) => system.techniques);
    const notes = layout.systems.flatMap((system) =>
      system.measures.flatMap((measure) => measure.notes),
    );

    expect(techniques).toHaveLength(0);
    expect(notes.some((note) => note.beatId === "mvp2-beat-1-1")).toBe(true);
    expect(JSON.stringify(layout)).not.toMatch(/Infinity|NaN/);
  });

  it("扫弦、琶音和单音技巧由核心输出最终 SVG 几何", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-strum",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      },
      {
        id: "tech-arpeggio",
        type: "arpeggio",
        beatId: "mvp2-beat-1-5",
        minString: 2,
        maxString: 6,
        direction: "ascending",
      },
      {
        id: "tech-tapping",
        type: "tapping",
        fromNoteId: "mvp2-note-1-1-6",
      },
      {
        id: "tech-trill",
        type: "trill",
        fromNoteId: "mvp2-note-1-3-5",
        auxiliaryFret: 7,
      },
    ];

    const layout = buildLayout(document, {
      systemWidth: 742,
      density: "compact",
    });
    const techniques = layout.systems.flatMap((system) => system.techniques);
    expect(techniques.map((item) => item.type)).toEqual(
      expect.arrayContaining(["strum", "arpeggio", "tapping", "trill"]),
    );
    expect(
      techniques.find((item) => item.type === "strum")?.path?.markerEnd,
    ).toBe("arrow");
    expect(
      techniques.find((item) => item.type === "arpeggio")?.path?.d,
    ).toContain("Q");
    expect(
      techniques.find((item) => item.type === "tapping")?.texts[0]?.text,
    ).toBe("T");
    expect(
      techniques.find((item) => item.type === "trill")?.texts[0]?.text,
    ).toBe("tr 7");
  });

  it("跨 system Tie 拆成两个开放弧线 segment，领域技巧保持单一", () => {
    const document = createDocument();
    // 只保留相邻两小节并限制硬宽，确保同弦同品位的相邻 Beat 真正跨行。
    document.score.tracks[0]!.measures[4]!.beats[0]!.notes[0] = {
      ...document.score.tracks[0]!.measures[4]!.beats[0]!.notes[0]!,
      string: 6,
      fret: 3,
    };
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-cross-tie",
        type: "tie",
        fromNoteId: "mvp2-note-4-6-6",
        toNoteId: "mvp2-note-5-1-6",
      },
    ];
    document.score.tracks[0]!.measures =
      document.score.tracks[0]!.measures.slice(3, 5);

    const layout = buildLayout(document, {
      systemWidth: 120,
      density: "compact",
    });
    expect(layout.systems).toHaveLength(2);
    const segments = layout.systems.flatMap((system) => system.techniques);
    expect(segments).toHaveLength(2);
    expect(segments.map((item) => item.continuation)).toEqual([
      "toNext",
      "fromPrevious",
    ]);
    expect(segments.every((item) => item.texts.length === 0)).toBe(true);
    expect(document.score.tracks[0]!.techniques).toHaveLength(1);

    const second = segments[1]!;
    expect(
      hitTestTechnique(layout, {
        x: second.bounds.x + second.bounds.width / 2,
        y: second.bounds.y + second.bounds.height / 2,
      }),
    ).toBe("tech-cross-tie");
  });

  it.each(["editing", "presentation"] as const)(
    "%s 在扫弦和休止拍琶音上方绘制一条可命中的延音线",
    (purpose) => {
      const document = createDocument();
      const track = document.score.tracks[0]!;
      track.measures = track.measures.slice(0, 1);
      const [from, to] = track.measures[0]!.beats;
      to!.kind = "rest";
      to!.notes = [];
      track.techniques = [
        { id: "strum", type: "strum", beatId: from!.id, minString: 1, maxString: 6, stroke: "down" },
        { id: "arpeggio", type: "arpeggio", beatId: to!.id, minString: 1, maxString: 6, direction: "ascending" },
        { id: "palm-mute", type: "palmMute", fromBeatId: from!.id, toBeatId: from!.id },
      ];
      const baseline = buildLayout(document, { purpose });
      track.techniques.push({ id: "traversal-tie", type: "traversalTie", fromBeatId: from!.id, toBeatId: to!.id });
      const source = structuredClone(document);

      const layout = buildLayout(document, { purpose });
      const system = layout.systems[0]!;
      const [fromLayout, toLayout] = system.measures[0]!.beats;
      const [tie] = system.techniques.filter((segment) => segment.type === "traversalTie");
      const { start, end } = tie!.focusEndpoints!;
      expect([start.x, end.x]).toEqual([fromLayout!.x, toLayout!.x]);
      expect(system.measures[0]!.beats.map(({ x }) => x)).toEqual(
        baseline.systems[0]!.measures[0]!.beats.map(({ x }) => x),
      );
      expect(tie).toMatchObject({ lane: 0, continuation: "none", texts: [] });
      expect(system.measures[0]!.restMarks).toEqual([]);
      for (const other of system.techniques.filter((segment) => segment !== tie)) {
        expect(techniqueInkIntersects(tie!, other)).toBe(false);
      }
      const traversalTop = Math.min(...system.techniques
        .filter((segment) => segment.type === "strum" || segment.type === "arpeggio")
        .flatMap(getTechniqueInkBounds).map(({ y }) => y));
      expect(traversalTop - start.y - tie!.path!.strokeWidth / 2).toBeCloseTo(LXM_TECHNIQUE_CURVE_INK_GAP);
      expect(system.measures[0]!.strings[0]!.y1 - start.y).toBeLessThan(10);
      expect(hitTestTechniqueTarget(layout, start)).toEqual({ techniqueId: "traversal-tie", focusEndpoint: "start" });
      expect(hitTestTechniqueTarget(layout, end)).toEqual({ techniqueId: "traversal-tie", focusEndpoint: "end" });
      const sceneItems = buildScoreScene(layout).systems[0]!.items;
      expect(sceneItems.filter((item) => item.techniqueId === "traversal-tie")).toEqual([
        expect.objectContaining({ kind: "path", d: tie!.path!.d, fill: "none" }),
      ]);
      expect(document).toEqual(source);
    },
  );

  it.each([true, false])("扫弦品位可见为 %s 时按可见墨迹定位延音线", (showFrets) => {
    const document = createDocument();
    const track = document.score.tracks[0]!;
    track.measures = track.measures.slice(0, 1);
    const [from, to] = track.measures[0]!.beats;
    from!.notes = [{ id: "top-fret", string: 1, fret: 3 }];
    track.techniques = [
      {
        id: "strum-show-frets", type: "strum", beatId: from!.id,
        minString: 1, maxString: 6, stroke: "up",
        ...(showFrets ? { showFrets: true as const } : {}),
      },
      { id: "next-strum", type: "strum", beatId: to!.id, minString: 1, maxString: 6, stroke: "up" },
      { id: "tie-show-frets", type: "traversalTie", fromBeatId: from!.id, toBeatId: to!.id },
    ];

    const system = buildLayout(document).systems[0]!;
    const fret = system.measures[0]!.notes.find((note) => note.id === "top-fret");
    expect(!!fret).toBe(showFrets);
    const sweeps = system.techniques.filter((segment) => segment.type === "strum");
    const traversalTop = Math.min(...sweeps.flatMap(getTechniqueInkBounds).map(({ y }) => y));
    const visibleTop = fret ? getFretTextBounds(fret).y : traversalTop;
    const tie = system.techniques.find((segment) => segment.type === "traversalTie")!;
    const arcBottom = tie.focusEndpoints!.start.y + tie.path!.strokeWidth / 2;
    expect(visibleTop - arcBottom).toBeCloseTo(LXM_TECHNIQUE_CURVE_INK_GAP);
  });

  it("扫弦延音线跨行时保留本行的节拍锚点和同一技巧 ID", () => {
    const document = createDocument();
    const track = document.score.tracks[0]!;
    track.measures = track.measures.slice(3, 5);
    const from = track.measures[0]!.beats.at(-1)!;
    const to = track.measures[1]!.beats[0]!;
    for (const beat of [from, to]) {
      beat.kind = "rest";
      beat.notes = [];
    }
    track.techniques = [
      { id: "first-strum", type: "strum", beatId: from.id, minString: 1, maxString: 6, stroke: "down" },
      { id: "second-strum", type: "strum", beatId: to.id, minString: 3, maxString: 6, stroke: "up" },
      { id: "wrapped-traversal-tie", type: "traversalTie", fromBeatId: from.id, toBeatId: to.id },
    ];

    const layout = buildLayout(document, { systemWidth: 120, density: "compact" });
    expect(layout.systems).toHaveLength(2);
    const [first, second] = layout.systems;
    const [outgoing, incoming] = layout.systems.flatMap((system) =>
      system.techniques.filter((segment) => segment.type === "traversalTie"),
    );
    expect(outgoing?.continuation).toBe("toNext");
    expect(incoming?.continuation).toBe("fromPrevious");
    const start = outgoing!.focusEndpoints!.start;
    const end = incoming!.focusEndpoints!.end;
    expect(start.x).toBe(first!.measures[0]!.beats.at(-1)!.x);
    expect(end.x).toBe(second!.measures[0]!.beats[0]!.x);
    const outgoingTraversal = first!.techniques.find((segment) => segment.type === "strum")!;
    const outgoingTop = Math.min(...getTechniqueInkBounds(outgoingTraversal).map(({ y }) => y));
    expect(outgoingTop - start.y).toBeCloseTo(LXM_TECHNIQUE_CURVE_INK_GAP + LXM_TECHNIQUE_PATH_STROKE_WIDTH / 2);
    expect(second!.measures[0]!.strings[0]!.y1 - end.y).toBeCloseTo(LXM_TECHNIQUE_CURVE_INK_GAP + LXM_TECHNIQUE_PATH_STROKE_WIDTH / 2);
    for (const segment of [outgoing!, incoming!]) {
      expect(segment.path?.d).toMatch(/^M .+ Q .+$/);
      expect(segment.focusEndpoints!.start.x).toBeLessThan(segment.focusEndpoints!.end.x);
    }
    expect(hitTestTechniqueTarget(layout, start)).toEqual({ techniqueId: "wrapped-traversal-tie", focusEndpoint: "start" });
    expect(hitTestTechniqueTarget(layout, end)).toEqual({ techniqueId: "wrapped-traversal-tie", focusEndpoint: "end" });
  });

  it("相交区间进入不同 lane，并把后续 system 向下推移", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-pm-1",
        type: "palmMute",
        fromBeatId: "mvp2-beat-1-1",
        toBeatId: "mvp2-beat-2-4",
      },
      {
        id: "tech-pm-2",
        type: "palmMute",
        fromBeatId: "mvp2-beat-1-3",
        toBeatId: "mvp2-beat-3-2",
      },
      {
        id: "tech-ring",
        type: "letRing",
        fromBeatId: "mvp2-beat-5-1",
        toBeatId: "mvp2-beat-8-5",
      },
    ] satisfies ILXMTechnique[];

    const withoutTechniques = createDocument();
    const baseline = buildLayout(withoutTechniques, {
      systemWidth: 742,
      density: "compact",
    });
    const layout = buildLayout(document, {
      systemWidth: 742,
      density: "compact",
    });
    expect(layout.systems[0]!.techniqueLaneCount).toBeGreaterThanOrEqual(2);
    expect(layout.systems[1]!.y).toBeGreaterThan(baseline.systems[1]!.y);
    expect(layout.height).toBeGreaterThan(baseline.height);
    expect(
      layout.systems
        .flatMap((system) => system.techniques)
        .some((item) => item.type === "letRing"),
    ).toBe(true);
  });
});
