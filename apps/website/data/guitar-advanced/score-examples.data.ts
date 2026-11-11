import type { ScoreExampleRef } from "../../lib/guitar-advanced/model";
/** 静态教学数据；不包含用户状态或运行时副作用。 */
export const GUITAR_ADVANCED_SCORE_EXAMPLES = [
  {
    id: "quarter-score",
    title: "四分节奏",
    caption: "4/4，每拍一个四分音符。",
    source: "teaching-document",
    documentId: "quarter",
  },
  {
    id: "rhythm-basic-score",
    title: "八分音符节奏谱例",
    caption: "4/4，每拍两个八分音符。",
    source: "teaching-document",
    documentId: "eighth",
  },
  {
    id: "sixteenth-score",
    title: "十六分节奏",
    caption: "4/4，每拍四个十六分音符。",
    source: "teaching-document",
    documentId: "sixteenth",
  },
  {
    id: "triplet-score",
    title: "三连音谱例",
    caption: "第一拍上方有 3 标记，后续每拍一个四分音符。",
    source: "teaching-document",
    documentId: "triplet",
  },
  {
    id: "syncopation-score",
    title: "切分延音谱例",
    caption: "第一拍后半的音延续到第二拍前半，观察跨拍连线。",
    source: "teaching-document",
    documentId: "syncopation",
  },
  {
    id: "chords-score",
    title: "C 大调和弦进行",
    caption: "按 C、F、G、C 顺序阅读和弦名称。",
    source: "teaching-document",
    documentId: "chords",
  },
  {
    id: "techniques-score",
    title: "常用技巧记号",
    caption: "依次观察 H、P、向上滑线、推弦箭头与最后的 x 音符。",
    source: "teaching-document",
    documentId: "techniques",
  },
] as const satisfies readonly ScoreExampleRef[];
