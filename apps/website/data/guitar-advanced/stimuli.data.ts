import type { ExerciseStimulus } from "../../lib/guitar-advanced/model";
/** 静态教学数据；不包含用户状态或运行时副作用。 */
export const GUITAR_ADVANCED_STIMULI = [
  {
    id: "quarter-stimulus",
    type: "scoreExample",
    scoreExampleId: "quarter-score",
    caption: "4/4，每拍一个四分音符。",
  },
  {
    id: "eighth-stimulus",
    type: "scoreExample",
    scoreExampleId: "rhythm-basic-score",
    caption: "4/4，每拍两个八分音符。",
  },
  {
    id: "sixteenth-stimulus",
    type: "scoreExample",
    scoreExampleId: "sixteenth-score",
    caption: "4/4，每拍四个十六分音符。",
  },
  {
    id: "triplet-stimulus",
    type: "scoreExample",
    scoreExampleId: "triplet-score",
    caption: "第一拍上方有 3 标记，后续每拍一个四分音符。",
  },
  {
    id: "syncopation-stimulus",
    type: "scoreExample",
    scoreExampleId: "syncopation-score",
    caption: "第一拍后半的音延续到第二拍前半，观察跨拍连线。",
  },
  {
    id: "chords-stimulus",
    type: "scoreExample",
    scoreExampleId: "chords-score",
    caption: "按 C、F、G、C 顺序阅读和弦名称。",
  },
  {
    id: "techniques-stimulus",
    type: "scoreExample",
    scoreExampleId: "techniques-score",
    caption: "依次观察 H、P、向上滑线、推弦箭头与最后的 x 音符。",
  },
] as const satisfies readonly ExerciseStimulus[];
