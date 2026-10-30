import type { FretboardDiagramData } from "../../lib/guitar-advanced/model";
/** 静态教学数据；不包含用户状态或运行时副作用。 */
export const GUITAR_ADVANCED_DIAGRAMS = [
  {
    id: "a-minor-fretboard",
    type: "fretboard",
    title: "标准调弦 · 第 6 弦 E / 第 5 弦 A · 0–5 品",
    tuning: "standard",
    stringNumbers: [6, 5],
    fretRange: {
      from: 0,
      to: 5,
    },
    positions: [
      {
        id: "string-6-fret-0",
        stringNumber: 6,
        fret: 0,
        noteName: "E",
      },
      {
        id: "string-6-fret-1",
        stringNumber: 6,
        fret: 1,
        noteName: "F",
      },
      {
        id: "string-6-fret-2",
        stringNumber: 6,
        fret: 2,
        noteName: "F#",
      },
      {
        id: "string-6-fret-3",
        stringNumber: 6,
        fret: 3,
        noteName: "G",
      },
      {
        id: "string-6-fret-4",
        stringNumber: 6,
        fret: 4,
        noteName: "G#",
      },
      {
        id: "string-6-fret-5",
        stringNumber: 6,
        fret: 5,
        noteName: "A",
      },
      {
        id: "string-5-fret-0",
        stringNumber: 5,
        fret: 0,
        noteName: "A",
      },
      {
        id: "string-5-fret-1",
        stringNumber: 5,
        fret: 1,
        noteName: "A#",
      },
      {
        id: "string-5-fret-2",
        stringNumber: 5,
        fret: 2,
        noteName: "B",
      },
      {
        id: "string-5-fret-3",
        stringNumber: 5,
        fret: 3,
        noteName: "C",
      },
      {
        id: "string-5-fret-4",
        stringNumber: 5,
        fret: 4,
        noteName: "C#",
      },
      {
        id: "string-5-fret-5",
        stringNumber: 5,
        fret: 5,
        noteName: "D",
      },
    ],
  },
] as const satisfies readonly FretboardDiagramData[];
