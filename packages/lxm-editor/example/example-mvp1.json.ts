/**
 * MVP 01
 * 
 * 简单小节渲染：
 *  - 节拍调号
 *  - 弦线和小节：需要考虑自适应宽度和自动换行
 *  - 简单音符（品位和炫号对应：数字标记、x 标记）
 *  - 小节线（单线）
 *  - 节奏型（全音、二分、四分、八分、十六分、三十二分音符、浮点音符）
 */

import { ILXMDocument } from "../src";

/**
 * MVP 02 简单编辑
 * 
 * - 数据流转 - 设计数据仓库 - 命令模式
 * - 编辑网格系统
 *  - 时值占位：每个音符根据不同时值占据不同的网格宽度
 *  - 缺失的音符需要占位
 * 
 * - MVP 01 的基础上，增加编辑功能
 * 
*/

const EXAMPLE_MVP_1: ILXMDocument = {
  schema: "lxm-tab-score",
  schemaVersion: 1,
  documentRevision: 1,
  // 乐谱信息
  score: {
    // 乐谱ID
    id: '',
    // 乐谱名称
    title: '',
    // 乐谱元信息
    meta: {},
    // 乐谱轨道
    tracks: [
      {
        // 轨道ID
        id: "track-guitar-001",
        // 轨道名称
        name: "原声吉他",
        // 类型
        instrument: "guitar",
        // 弦乐
        tuning: {
          strings:  [
            { index: 1, pitch: "E4", midi: 64 },
            { index: 2, pitch: "B3", midi: 59 },
            { index: 3, pitch: "G3", midi: 55 },
            { index: 4, pitch: "D3", midi: 50 },
            { index: 5, pitch: "A2", midi: 45 },
            { index: 6, pitch: "E2", midi: 40 },
          ],
        },
        // 小节集合
        measures:[
          {
            // 小节ID
            id: "measure-001",
            // 节拍调号
            timeSignature: { numerator: 4, denominator: 4 },
            // 小节线
            barline: "single",
            // 和弦
            chordSymbols: [
              {
                id: "chord-symbol-001",
                tick: 0,
                chordDefinitionId: "chord-am-open",
                display: "nameAndDiagram",
              },
            ],
            // 节拍
            beats: [
              // 第一拍
              {
                id: "beat-001-00",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'quarter', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-00', string: 5, fret: 3 }
                ],
              },
              // 第二拍
              {
                id: "beat-001-01",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'eighth', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-01', string: 3, fret: 3 },
                  { id: 'note-001-01', string: 2, fret: 3 }
                ],
              },
              {
                id: "beat-001-02",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'eighth', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-03', string: 5, fret: 5 }
                ],
              },
              // 第三拍
              {
                id: "beat-001-03",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'eighth', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-03', string: 5, fret: 5 }
                ],
              },
              {
                id: "beat-001-04",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'sixteenth', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-04', string: 2, fret: 3 },
                  { id: 'note-001-05', string: 6, fret: 0 }
                ],
              },
              {
                id: "beat-001-05",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'sixteenth', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-06', string: 6, fret: 3 }
                ],
              },
              // 第四拍
              {
                id: "beat-001-6",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'sixteenth', dots: 0 }, // rhythm("eighth"),
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-07', string: 6, fret: 3 },
                  { id: 'note-001-08', string: 2, fret: 3 }
                ],
              },
              {
                id: "beat-001-7",
                // 时值
                tick: 0,
                // 节奏
                rhythm: { base: 'eighth', dots: 0 },
                // 类型
                kind: "notes",
                // 具体标记
                notes: [
                  // string: 弦号，fret：品位
                  { id: 'note-001-09', string: 6, fret: 0 }
                ],
              }
            ]
          }
        ]
      }
    ]
  }
}

export default EXAMPLE_MVP_1;