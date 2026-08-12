import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import type { ILXMTechnique } from "../../src/core/types";
import { buildLayout, hitTestTechnique } from "../../src/layout";

const createDocument = () => structuredClone(EXAMPLE_MVP_2);

describe("MVP v5 技巧布局", () => {
  it("扫弦、琶音和单音技巧由核心输出最终 SVG 几何", () => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-strum",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        stroke: "down",
      },
      {
        id: "tech-arpeggio",
        type: "arpeggio",
        beatId: "mvp2-beat-1-5",
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
