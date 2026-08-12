/**
 * MVP v2 规范测试谱例。
 *
 * 固定 8 个 4/4 小节，用于 system 自动换行、命中索引和 note.set / note.remove
 * 的共同回归。数据保持静态可复现，测试需要修改时必须先复制该对象。
 */

import type { ILXMBeat, ILXMDocument, ILXMMeasure, ILXMNote } from "../src";

/**
 * 构建一个 4/4 小节。
 *
 * beats 由调用方给出，从而让规范谱例覆盖四分、八分、十六分、三十二分与附点等
 * 不同节奏。每个 beat 至少保留一个音符，确保当前符干、连梁和命中逻辑均可消费。
 */
const createMeasure = (
  measureNumber: number,
  beats: ILXMBeat[],
  barline: ILXMMeasure["barline"] = "single",
  chordSymbols: ILXMMeasure["chordSymbols"] = [],
): ILXMMeasure => ({
  id: `mvp2-measure-${measureNumber}`,
  timeSignature: { numerator: 4, denominator: 4 },
  barline,
  chordSymbols,
  beats,
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

/**
 * 构建 beat 并统一生成稳定 ID。
 *
 * tick 是 beat 在小节内的开始时间；示例中的 tick 均按 960 ticks/四分音符填写，
 * 便于阅读节奏容量和连梁分组边界。
 */
const beat = (
  measure: number,
  index: number,
  tick: number,
  rhythm: ILXMBeat["rhythm"],
  notes: ILXMNote[],
): ILXMBeat => ({
  id: `mvp2-beat-${measure}-${index}`,
  tick,
  rhythm,
  kind: "notes",
  notes,
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
        startBarline: "none",
        techniques: [],
        measures: [
          // 小节 1：沿用 MVP1 的混合节奏与 Am 标记，覆盖附点和短时值连梁。
          createMeasure(
            1,
            [
              beat(1, 1, 0, { base: "quarter", dots: 0 }, [note(1, 1, 6, 0)]),
              beat(1, 2, 960, { base: "eighth", dots: 1 }, [
                note(1, 2, 3, 3),
                note(1, 2, 2, 3),
              ]),
              beat(1, 3, 1680, { base: "sixteenth", dots: 0 }, [
                note(1, 3, 5, 5),
              ]),
              beat(1, 4, 1920, { base: "eighth", dots: 0 }, [note(1, 4, 5, 5)]),
              beat(1, 5, 2400, { base: "sixteenth", dots: 0 }, [
                note(1, 5, 2, 3),
                note(1, 5, 6, 0),
              ]),
              beat(1, 6, 2640, { base: "sixteenth", dots: 0 }, [
                note(1, 6, 6, 3),
              ]),
              beat(1, 7, 2880, { base: "sixteenth", dots: 1 }, [
                note(1, 7, 6, 3),
                note(1, 7, 2, 3),
              ]),
              beat(1, 8, 3240, { base: "eighth", dots: 0 }, [
                note(1, 8, 6, 3),
                note(1, 8, 2, 3),
              ]),
              beat(1, 9, 3720, { base: "thirtySecond", dots: 0 }, [
                note(1, 9, 5, 6),
              ]),
            ],
            "single",
            [
              {
                id: "mvp2-chord-am",
                tick: 0,
                chordDefinitionId: "chord-am-open",
                display: "nameAndDiagram",
              },
            ],
          ),
          // 小节 2：八分音符分解和弦；同拍双弦保留，适合覆盖其中一根弦的测试。
          createMeasure(2, [
            beat(2, 1, 0, { base: "eighth", dots: 0 }, [
              note(2, 1, 5, 3),
              note(2, 1, 2, 3),
            ]),
            beat(2, 2, 480, { base: "eighth", dots: 0 }, [note(2, 2, 4, 2)]),
            beat(2, 3, 960, { base: "eighth", dots: 0 }, [note(2, 3, 3, 0)]),
            beat(2, 4, 1440, { base: "eighth", dots: 0 }, [note(2, 4, 2, 1)]),
            beat(2, 5, 1920, { base: "eighth", dots: 0 }, [note(2, 5, 1, 0)]),
            beat(2, 6, 2400, { base: "eighth", dots: 0 }, [note(2, 6, 2, 1)]),
            beat(2, 7, 2880, { base: "eighth", dots: 0 }, [note(2, 7, 3, 0)]),
            beat(2, 8, 3360, { base: "eighth", dots: 0 }, [note(2, 8, 4, 2)]),
          ]),
          // 小节 3：十六分音符走句，覆盖三层以内的连梁与高品位 12/24。
          createMeasure(3, [
            beat(3, 1, 0, { base: "sixteenth", dots: 0 }, [note(3, 1, 1, 12)]),
            beat(3, 2, 240, { base: "sixteenth", dots: 0 }, [
              note(3, 2, 2, 10),
            ]),
            beat(3, 3, 480, { base: "sixteenth", dots: 0 }, [note(3, 3, 3, 9)]),
            beat(3, 4, 720, { base: "sixteenth", dots: 0 }, [note(3, 4, 4, 7)]),
            beat(3, 5, 960, { base: "sixteenth", dots: 0 }, [
              note(3, 5, 1, 24),
            ]),
            beat(3, 6, 1200, { base: "sixteenth", dots: 0 }, [
              note(3, 6, 2, 12),
            ]),
            beat(3, 7, 1440, { base: "sixteenth", dots: 0 }, [
              note(3, 7, 3, 10),
            ]),
            beat(3, 8, 1680, { base: "sixteenth", dots: 0 }, [
              note(3, 8, 4, 9),
            ]),
            beat(3, 9, 1920, { base: "sixteenth", dots: 0 }, [
              note(3, 9, 5, 7),
            ]),
            beat(3, 10, 2160, { base: "sixteenth", dots: 0 }, [
              note(3, 10, 4, 9),
            ]),
            beat(3, 11, 2400, { base: "sixteenth", dots: 0 }, [
              note(3, 11, 3, 10),
            ]),
            beat(3, 12, 2640, { base: "sixteenth", dots: 0 }, [
              note(3, 12, 2, 12),
            ]),
            beat(3, 13, 2880, { base: "sixteenth", dots: 0 }, [
              note(3, 13, 1, 24),
            ]),
            beat(3, 14, 3120, { base: "sixteenth", dots: 0 }, [
              note(3, 14, 2, 12),
            ]),
            beat(3, 15, 3360, { base: "sixteenth", dots: 0 }, [
              note(3, 15, 3, 10),
            ]),
            beat(3, 16, 3600, { base: "sixteenth", dots: 0 }, [
              note(3, 16, 4, 9),
            ]),
          ]),
          // 小节 4：双附点、附点八分与短时值混合，作为附点布局回归数据。
          createMeasure(4, [
            beat(4, 1, 0, { base: "quarter", dots: 2 }, [note(4, 1, 1, 5)]),
            beat(4, 2, 1680, { base: "sixteenth", dots: 0 }, [
              note(4, 2, 2, 7),
            ]),
            beat(4, 3, 1920, { base: "eighth", dots: 1 }, [note(4, 3, 3, 5)]),
            beat(4, 4, 2640, { base: "sixteenth", dots: 0 }, [
              note(4, 4, 4, 7),
            ]),
            beat(4, 5, 2880, { base: "eighth", dots: 0 }, [note(4, 5, 5, 5)]),
            beat(4, 6, 3360, { base: "eighth", dots: 0 }, [note(4, 6, 6, 3)]),
          ]),
          // 小节 5：长时值低音与中声部和弦，验证不同列宽和多弦音符。
          createMeasure(
            5,
            [
              beat(5, 1, 0, { base: "half", dots: 0 }, [
                note(5, 1, 6, 5),
                note(5, 1, 4, 7),
              ]),
              beat(5, 2, 1920, { base: "quarter", dots: 0 }, [
                note(5, 2, 5, 7),
                note(5, 2, 3, 7),
              ]),
              beat(5, 3, 2880, { base: "quarter", dots: 0 }, [
                note(5, 3, 6, 5),
                note(5, 3, 2, 8),
              ]),
            ],
            "double",
          ),
          // 小节 6：高音弦旋律，覆盖第一、二弦命中边界和十六分连梁。
          createMeasure(6, [
            beat(6, 1, 0, { base: "eighth", dots: 0 }, [note(6, 1, 1, 8)]),
            beat(6, 2, 480, { base: "sixteenth", dots: 0 }, [
              note(6, 2, 2, 10),
            ]),
            beat(6, 3, 720, { base: "sixteenth", dots: 0 }, [
              note(6, 3, 1, 12),
            ]),
            beat(6, 4, 960, { base: "eighth", dots: 0 }, [note(6, 4, 2, 10)]),
            beat(6, 5, 1440, { base: "eighth", dots: 0 }, [note(6, 5, 1, 8)]),
            beat(6, 6, 1920, { base: "quarter", dots: 0 }, [note(6, 6, 2, 10)]),
            beat(6, 7, 2880, { base: "quarter", dots: 0 }, [note(6, 7, 1, 12)]),
          ]),
          // 小节 7：低音与高音交替，确保第二行中部仍有丰富的可编辑目标。
          createMeasure(7, [
            beat(7, 1, 0, { base: "quarter", dots: 0 }, [
              note(7, 1, 6, 0),
              note(7, 1, 3, 5),
            ]),
            beat(7, 2, 960, { base: "eighth", dots: 0 }, [note(7, 2, 5, 2)]),
            beat(7, 3, 1440, { base: "eighth", dots: 0 }, [note(7, 3, 2, 8)]),
            beat(7, 4, 1920, { base: "sixteenth", dots: 0 }, [
              note(7, 4, 4, 5),
            ]),
            beat(7, 5, 2160, { base: "sixteenth", dots: 0 }, [
              note(7, 5, 3, 7),
            ]),
            beat(7, 6, 2400, { base: "sixteenth", dots: 0 }, [
              note(7, 6, 2, 8),
            ]),
            beat(7, 7, 2640, { base: "sixteenth", dots: 0 }, [
              note(7, 7, 1, 10),
            ]),
            beat(7, 8, 2880, { base: "quarter", dots: 0 }, [note(7, 8, 6, 3)]),
          ]),
          // 小节 8：终止小节线与收束和弦，覆盖最后一行、最后 beat 和 final barline。
          createMeasure(
            8,
            [
              beat(8, 1, 0, { base: "quarter", dots: 0 }, [
                note(8, 1, 6, 0),
                note(8, 1, 5, 2),
              ]),
              beat(8, 2, 960, { base: "eighth", dots: 0 }, [note(8, 2, 4, 2)]),
              beat(8, 3, 1440, { base: "eighth", dots: 0 }, [note(8, 3, 3, 1)]),
              beat(8, 4, 1920, { base: "quarter", dots: 0 }, [
                note(8, 4, 2, 0),
              ]),
              beat(8, 5, 2880, { base: "quarter", dots: 0 }, [
                note(8, 5, 1, 0),
                note(8, 5, 3, 1),
              ]),
            ],
            "final",
          ),
        ],
      },
    ],
  },
};

export default EXAMPLE_MVP_2;
