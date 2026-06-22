import { STANDARD_GUITAR_TUNING } from "./constants";
import { getMeasureCapacityTicks } from "./rhythm";
import type { Beat, Measure, RhythmValue, Score, TimeSignature } from "./schema";

const DEFAULT_BEAT_RHYTHM: RhythmValue = { base: "quarter", dots: 0 };

export interface CreateEmptyMeasureOptions {
  id: string;
  beatIdPrefix?: string;
  timeSignature?: TimeSignature;
  includeTimeSignature?: boolean;
  barline?: Measure["barline"];
}

/**
 * 根据拍号创建一个容量合法的空白小节。
 *
 * MVP 阶段默认按四分音符切分拍点：4/4 得到 4 个 quarter rest，
 * 3/4 得到 3 个 quarter rest。后续如果支持 6/8 等复合拍，可在这里扩展
 * 默认切分策略，页面层仍然不需要理解 tick 计算。
 */
export const createEmptyMeasure = ({
  id,
  beatIdPrefix = `${id}-beat`,
  timeSignature = { numerator: 4, denominator: 4 },
  includeTimeSignature = false,
  barline,
}: CreateEmptyMeasureOptions): Measure => {
  const capacity = getMeasureCapacityTicks(timeSignature);
  const quarterTicks = 960;
  /*
   * 当前 MVP 的小节模板按四分音符做最小默认切分。
   * 这里的 beatCount 本质是“小节总 tick / 四分音符 tick”，例如：
   * 4/4 = 3840 / 960 = 4，3/4 = 2880 / 960 = 3。
   */
  const beatCount = Math.max(1, capacity / quarterTicks);
  const beats: Beat[] = Array.from({ length: beatCount }, (_, index) => ({
    id: `${beatIdPrefix}-${index + 1}`,
    tick: index * quarterTicks,
    rhythm: DEFAULT_BEAT_RHYTHM,
    kind: "rest",
  }));

  return {
    id,
    ...(includeTimeSignature ? { timeSignature } : {}),
    ...(barline ? { barline } : {}),
    beats,
    tuplets: [],
    chordSymbols: [],
    lyrics: [],
  };
};

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
      measures: [
        createEmptyMeasure({
          id: "measure-001",
          beatIdPrefix: "beat-001",
          timeSignature: { numerator: 4, denominator: 4 },
          includeTimeSignature: true,
          barline: "final",
        }),
      ],
    },
  ],
  chordLibrary: [],
});
