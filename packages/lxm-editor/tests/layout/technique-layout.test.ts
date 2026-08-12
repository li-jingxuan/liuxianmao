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
} from "../../src/layout/layout-constants";

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
    // 紧凑 A4 基线按 4+4 断行；把第五小节首音改成上一行末拍同弦同品位，
    // 构造合法的相邻 Beat 跨行 Tie。
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

    const layout = buildLayout(document, {
      systemWidth: 742,
      density: "compact",
    });
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
