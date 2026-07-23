/**
 * MVP v2 规范测试谱例。
 *
 * 固定 8 个 4/4 小节，用于 system 自动换行、命中索引和 note.set / note.remove
 * 的共同回归。数据保持静态可复现，测试需要修改时必须先复制该对象。
 */

import type { ILXMDocument, ILXMMeasure, ILXMNote } from "../src";

/** 标准四分音符节拍的起始 tick，4/4 小节中正好填满 3840 tick。 */
const QUARTER_TICKS = [0, 960, 1920, 2880] as const;

/**
 * 构建一个固定 4/4 小节。
 *
 * notesByBeat 的每一项对应一个四分音符 beat；保留每个 beat 至少一个音符，确保
 * 当前 MVP 的符干和连梁布局可以直接消费该 fixture。
 */
const createMeasure = (
  measureNumber: number,
  notesByBeat: ILXMNote[][],
  barline: ILXMMeasure["barline"] = "single",
): ILXMMeasure => ({
  id: `mvp2-measure-${measureNumber}`,
  timeSignature: { numerator: 4, denominator: 4 },
  barline,
  chordSymbols: [],
  beats: QUARTER_TICKS.map((tick, beatIndex) => ({
    id: `mvp2-beat-${measureNumber}-${beatIndex + 1}`,
    tick,
    rhythm: { base: "quarter", dots: 0 },
    kind: "notes",
    notes: notesByBeat[beatIndex]!,
  })),
});

/** 为 fixture 内的音符生成可读且全局唯一的稳定 ID。 */
const note = (
  measure: number,
  beat: number,
  string: number,
  fret: number,
): ILXMNote => ({
  id: `mvp2-note-${measure}-${beat}-${string}`,
  string,
  fret,
});

/** MVP v2 的默认文档；默认导出供 EXAMPLE_MVP_2.default 使用。 */
const EXAMPLE_MVP_2: ILXMDocument = {
  schema: "lxm-tab-score",
  schemaVersion: 1,
  documentRevision: 1,
  score: {
    id: "mvp2-score",
    title: "MVP v2 多行谱面测试",
    meta: { fixture: "mvp-v2" },
    tracks: [
      {
        id: "mvp2-track-guitar",
        name: "标准调弦吉他",
        instrument: "guitar",
        tuning: {
          strings: [
            { index: 1, pitch: "E4", midi: 64 },
            { index: 2, pitch: "B3", midi: 59 },
            { index: 3, pitch: "G3", midi: 55 },
            { index: 4, pitch: "D3", midi: 50 },
            { index: 5, pitch: "A2", midi: 45 },
            { index: 6, pitch: "E2", midi: 40 },
          ],
        },
        measures: [
          // 小节 1：开放弦与普通单音，覆盖品位 0 的输入场景。
          createMeasure(1, [
            [note(1, 1, 6, 0)],
            [note(1, 2, 5, 3)],
            [note(1, 3, 4, 2)],
            [note(1, 4, 3, 0)],
          ]),
          // 小节 2：同拍双弦和弦，验证覆盖其中一根弦时其余音保持不变。
          createMeasure(2, [
            [note(2, 1, 5, 3), note(2, 1, 2, 3)],
            [note(2, 2, 4, 2), note(2, 2, 3, 2)],
            [note(2, 3, 5, 0), note(2, 3, 2, 0)],
            [note(2, 4, 6, 3), note(2, 4, 1, 3)],
          ]),
          // 小节 3：两位品位与最大品位，覆盖键盘草稿和边界值。
          createMeasure(3, [
            [note(3, 1, 1, 12)],
            [note(3, 2, 2, 24)],
            [note(3, 3, 3, 12)],
            [note(3, 4, 4, 24)],
          ]),
          // 小节 4：每拍只保留一个音，作为删除后的稀疏音符场景。
          createMeasure(4, [
            [note(4, 1, 1, 5)],
            [note(4, 2, 3, 7)],
            [note(4, 3, 5, 5)],
            [note(4, 4, 6, 3)],
          ]),
          // 小节 5：低音弦为主，用于换行后的弦命中测试。
          createMeasure(5, [
            [note(5, 1, 6, 5)],
            [note(5, 2, 5, 7)],
            [note(5, 3, 6, 7)],
            [note(5, 4, 5, 5)],
          ]),
          // 小节 6：高音弦为主，用于第一、二弦命中边界测试。
          createMeasure(6, [
            [note(6, 1, 1, 8)],
            [note(6, 2, 2, 10)],
            [note(6, 3, 1, 12)],
            [note(6, 4, 2, 10)],
          ]),
          // 小节 7：普通单音序列，作为第二行中部的稳定回归数据。
          createMeasure(7, [
            [note(7, 1, 4, 5)],
            [note(7, 2, 3, 7)],
            [note(7, 3, 2, 8)],
            [note(7, 4, 1, 10)],
          ]),
          // 小节 8：终止小节线，覆盖最后一行和最后一个 beat 的命中。
          createMeasure(
            8,
            [
              [note(8, 1, 6, 0)],
              [note(8, 2, 5, 2)],
              [note(8, 3, 4, 2)],
              [note(8, 4, 3, 1)],
            ],
            "final",
          ),
        ],
      },
    ],
  },
};

export default EXAMPLE_MVP_2;
