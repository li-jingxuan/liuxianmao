/** v5.1 八小节规范谱例；时间数据是人工列举的验收常量，不由待测换算实现生成。 */
import type {
  ILXMDocument,
  ILXMMeasure,
  ILXMTupletRatio,
} from "../src/core/types";
import EXAMPLE_MVP_5 from "./example-mvp5.json";
const scenarios: {
  ratio: ILXMTupletRatio;
  base: "eighth" | "sixteenth";
  dots: number;
  ticks: number[];
  end: number;
}[] = [
  {
    ratio: { actual: 3, normal: 2 },
    base: "eighth",
    dots: 0,
    ticks: [0, 320, 640],
    end: 960,
  },
  {
    ratio: { actual: 2, normal: 3 },
    base: "eighth",
    dots: 0,
    ticks: [0, 720],
    end: 1440,
  },
  {
    ratio: { actual: 4, normal: 3 },
    base: "sixteenth",
    dots: 0,
    ticks: [0, 180, 360, 540],
    end: 720,
  },
  {
    ratio: { actual: 5, normal: 4 },
    base: "sixteenth",
    dots: 0,
    ticks: [0, 192, 384, 576, 768],
    end: 960,
  },
  {
    ratio: { actual: 5, normal: 3 },
    base: "sixteenth",
    dots: 0,
    ticks: [0, 144, 288, 432, 576],
    end: 720,
  },
  {
    ratio: { actual: 6, normal: 4 },
    base: "sixteenth",
    dots: 0,
    ticks: [0, 160, 320, 480, 640, 800],
    end: 960,
  },
  {
    ratio: { actual: 3, normal: 2 },
    base: "eighth",
    dots: 1,
    ticks: [0, 480, 960],
    end: 1440,
  },
  {
    ratio: { actual: 3, normal: 2 },
    base: "eighth",
    dots: 0,
    ticks: [0, 320, 640],
    end: 960,
  },
];
const measures: ILXMMeasure[] = scenarios.map((scenario, index) => {
  const prefix = `mvp51-${index + 1}`;
  const beats = scenario.ticks.map((tick, member) => ({
    id: `${prefix}-beat-${member + 1}`,
    tick,
    rhythm: { base: scenario.base, dots: scenario.dots },
    kind: index === 7 && member === 1 ? ("rest" as const) : ("notes" as const),
    notes:
      index === 7 && member > 0
        ? []
        : [
            {
              id: `${prefix}-note-${member + 1}`,
              string: (member % 6) + 1,
              fret: member + 3,
            },
          ],
  }));
  // 每组之后用人工容量拆分补齐 4/4，末拍保持可编辑空单元格。
  const remaining =
    scenario.end === 720
      ? [
          { tick: 720, base: "half" as const },
          { tick: 2640, base: "quarter" as const },
          { tick: 3600, base: "sixteenth" as const },
        ]
      : scenario.end === 1440
        ? [
            { tick: 1440, base: "half" as const },
            { tick: 3360, base: "eighth" as const },
          ]
        : [
            { tick: 960, base: "half" as const },
            { tick: 2880, base: "quarter" as const },
          ];
  return {
    id: `${prefix}-measure`,
    timeSignature: { numerator: 4, denominator: 4 },
    barline: index === 7 ? "final" : "single",
    chordSymbols: [],
    tuplets: [
      {
        id: `${prefix}-tuplet`,
        beatIds: beats.map((beat) => beat.id),
        ratio: scenario.ratio,
      },
    ],
    beats: [
      ...beats,
      ...remaining.map((rest, i) => ({
        id: `${prefix}-rest-${i}`,
        tick: rest.tick,
        rhythm: { base: rest.base, dots: 0 },
        kind: "rest" as const,
        notes: [],
      })),
    ],
  };
});
const document: ILXMDocument = {
  ...EXAMPLE_MVP_5,
  score: {
    ...EXAMPLE_MVP_5.score,
    title: "MVP v5.1 连音组节奏",
    meta: { fixture: "mvp-v5.1" },
    tracks: [
      {
        ...EXAMPLE_MVP_5.score.tracks[0]!,
        measures,
        techniques: [
          {
            id: "mvp51-vibrato",
            type: "vibrato",
            fromNoteId: "mvp51-1-note-1",
          },
          {
            id: "mvp51-palm",
            type: "palmMute",
            fromBeatId: "mvp51-6-beat-1",
            toBeatId: "mvp51-6-beat-6",
          },
        ],
      },
    ],
  },
};
export default document;
