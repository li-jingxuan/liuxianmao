import {
  CURRENT_SCHEMA_VERSION,
  SCORE_DOCUMENT_SCHEMA,
  STANDARD_GUITAR_TUNING,
} from "../src/core/constants";
import { calculateRhythmTicks } from "../src/core/rhythm";
import { copyChordPreset } from "../src/core/chord-presets";
import type { ILXMBeat, ILXMDocument, ILXMMeasure } from "../src/core/types";

interface MockBeat {
  numbered?: string;
  notes: readonly (readonly [string: number, fret: number])[];
  base?: ILXMBeat["rhythm"]["base"];
  dots?: number;
}

/** 按真实时值累计 tick；简谱只作为独立标注，不从品位推导音级。 */
const createMeasure = (
  number: number,
  sectionLabel: string,
  entries: readonly MockBeat[],
  verses: readonly (readonly string[])[] = [],
  chordName?: string,
): ILXMMeasure => {
  let tick = 0;
  const beats: ILXMBeat[] = entries.map((entry, index) => {
    const id = `mvp72-beat-${number}-${index + 1}`;
    const rhythm = { base: entry.base ?? "quarter", dots: entry.dots ?? 0 };
    const duration = calculateRhythmTicks(rhythm);
    if (!duration.ok) throw new Error("MVP v7.2 mock 包含不可表示的时值。");
    const beat: ILXMBeat = {
      id,
      tick,
      rhythm,
      kind: entry.notes.length ? "notes" : "rest",
      notes: entry.notes.map(([string, fret]) => ({
        id: `${id}-note-${string}`,
        string,
        fret,
      })),
      ...(entry.numbered
        ? { numberedNotation: { tokens: entry.numbered.split("+") } }
        : {}),
    };
    tick += duration.ticks;
    return beat;
  });
  if (tick !== 3840) throw new Error("MVP v7.2 mock 的 4/4 小节须恰好四拍。");
  // 各和弦标记独立复制标准模板，名称与指法图一致，避免共享可变指法数据。
  const chord = chordName ? copyChordPreset(chordName) : null;
  if (chordName && !chord) throw new Error(`缺少 ${chordName} 和弦指法模板。`);
  return {
    id: `mvp72-measure-${number}`,
    timeSignature: { numerator: 4, denominator: 4 },
    barline: number === 8 ? "final" : "single",
    sectionLabel,
    beats,
    tuplets: [],
    // 按 Beat、段号顺序生成歌词，满足正式 loader 的排序约束；两行歌词验证竖线上缘。
    lyrics: beats.flatMap((beat, index) =>
      verses.flatMap((words, verseIndex) =>
        words[index]
          ? [
              {
                id: `mvp72-lyric-${number}-${verseIndex + 1}-${index + 1}`,
                beatId: beat.id,
                verse: (verseIndex + 1) as 1 | 2,
                text: words[index]!,
              },
            ]
          : [],
      ),
    ),
    chordSymbols: chord
      ? [
          {
            id: `mvp72-chord-${number}`,
            beatId: beats[0]!.id,
            display: "nameAndDiagram",
            chord,
          },
        ]
      : [],
  };
};

/** 短谱集中覆盖已实现的简谱能力，空拍与无简谱小节留作交互录入目标。 */
const document: ILXMDocument = {
  schema: SCORE_DOCUMENT_SCHEMA,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  documentRevision: 1,
  score: {
    id: "mvp72-numbered-mock",
    title: "MVP v7.2 简谱测试谱",
    arranger: "六线猫",
    keySignature: "C",
    meta: { fixture: "mvp-v7.2-numbered", purpose: "简谱编辑与布局验收" },
    tracks: [
      {
        id: "mvp72-track-guitar",
        name: "标准调弦吉他",
        instrument: "guitar",
        tuning: {
          strings: structuredClone(STANDARD_GUITAR_TUNING).map((string) => ({
            ...string,
          })),
        },
        capo: 0,
        startBarline: "none",
        techniques: [],
        measures: [
          createMeasure(
            1,
            "普通音级",

            [
              { numbered: "1", notes: [[2, 1]] },
              { numbered: "2", notes: [[2, 3]] },
              { numbered: "3", notes: [[1, 0]] },
              { numbered: "5", notes: [[1, 3]] },
            ],
            [["轻", "轻", "唱", "起"]],
            "C",
          ),
          createMeasure(
            2,
            "八分节奏与高音",
            [
              { numbered: "5", notes: [[1, 3]], base: "eighth" },
              { numbered: "6", notes: [[1, 5]], base: "eighth" },
              { numbered: "7", notes: [[1, 7]], base: "eighth" },
              { numbered: "1'", notes: [[1, 8]], base: "eighth" },
              { numbered: "2'", notes: [[1, 10]], base: "eighth" },
              { numbered: "3'", notes: [[1, 12]], base: "eighth" },
              { numbered: "2'", notes: [[1, 10]], base: "eighth" },
              { numbered: "1'", notes: [[1, 8]], base: "eighth" },
            ],
            [["旋", "律", "随", "风", "慢", "慢", "升", "起"]],
          ),
          createMeasure(3, "升降号与多级八度", [
            { numbered: "#4'", notes: [[1, 14]] },
            { numbered: "b7.", notes: [[3, 3]] },
            { numbered: "1''", notes: [[1, 20]] },
            { numbered: "6...", notes: [[5, 0]] },
          ]),
          createMeasure(
            4,
            "同拍多音与两行歌词",
            [
              {
                numbered: "1+3+5",
                notes: [
                  [3, 0],
                  [2, 1],
                  [1, 0],
                ],
              },
              {
                numbered: "2+4+6",
                notes: [
                  [3, 2],
                  [2, 3],
                  [1, 1],
                ],
              },
              {
                numbered: "3+5+7",
                notes: [
                  [3, 4],
                  [2, 5],
                  [1, 3],
                ],
              },
              {
                numbered: "1'+3'+5'",
                notes: [
                  [3, 12],
                  [2, 13],
                  [1, 12],
                ],
              },
            ],
            [
              ["和", "声", "轻", "响"],
              ["再", "唱", "一", "遍"],
            ],
            "C",
          ),
          createMeasure(5, "休止与延音标记", [
            { numbered: "0", notes: [] },
            { numbered: "-", notes: [[1, 3]] },
            { numbered: "5", notes: [[1, 3]] },
            { numbered: "0", notes: [] },
          ]),
          createMeasure(6, "空简谱拍：可补录", [
            { numbered: "1", notes: [[2, 1]] },
            { notes: [[2, 3]] },
            { numbered: "3", notes: [[1, 0]] },
            { notes: [[1, 3]] },
          ]),
          createMeasure(7, "无简谱与歌词：横梁收边", [
            { notes: [[2, 1]], base: "eighth" },
            { notes: [[2, 3]], base: "eighth" },
            { notes: [[1, 0]], base: "eighth" },
            { notes: [[1, 1]], base: "eighth" },
            { notes: [[1, 3]], base: "eighth" },
            { notes: [[1, 1]], base: "eighth" },
            { notes: [[1, 0]], base: "eighth" },
            { notes: [[2, 1]], base: "eighth" },
          ]),
          createMeasure(
            8,
            "附点与长音收尾",
            [
              { numbered: "1", notes: [[2, 1]], dots: 1 },
              { numbered: "2", notes: [[2, 3]], base: "eighth" },
              { numbered: "1", notes: [[2, 1]], base: "half" },
            ],
            [
              ["歌", "声", "落"],
              ["余", "音", "长"],
            ],
            "C",
          ),
        ],
      },
    ],
  },
};

export default document;
