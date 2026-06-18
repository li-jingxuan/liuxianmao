import { STANDARD_GUITAR_TUNING } from "./constants";
import type { Score } from "./schema";

/** 创建结构合法但不含小节的初始单吉他轨乐谱。 */
export const createEmptyScore = (): Score => ({
  id: "score-new",
  title: "未命名乐谱 1",
  meta: {
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: "C",
    capo: 0,
  },
  tracks: [
    {
      id: "track-guitar-main",
      name: "吉他",
      instrument: "guitar",
      tuning: { strings: STANDARD_GUITAR_TUNING.map((item) => ({ ...item })) },
      measures: [],
    },
  ],
  chordLibrary: [],
});
