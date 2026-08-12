/**
 * MVP v5 吉他技巧规范谱例。
 *
 * 该 fixture 复用 v4 的稳定八小节与全部 Note/Beat ID，只新增技巧实体。技巧分布
 * 在两条 A4 system，并覆盖单音、连接、整拍和 Beat 区间四类目标，供页面、布局
 * 与历史测试共享真实数据，而不是在 React 中用静态装饰伪造完成状态。
 */
import type { ILXMDocument, ILXMTechnique } from "../src";
import EXAMPLE_MVP_4 from "./example-mvp4.json";

const techniques: ILXMTechnique[] = [
  {
    id: "mvp5-tech-hammer",
    type: "hammerOn",
    fromNoteId: "mvp2-note-6-1-1",
    toNoteId: "mvp2-note-6-3-1",
  },
  {
    id: "mvp5-tech-pull",
    type: "pullOff",
    fromNoteId: "mvp2-note-7-6-2",
    toNoteId: "mvp2-note-8-4-2",
  },
  {
    id: "mvp5-tech-slide-up",
    type: "slideUp",
    fromNoteId: "mvp2-note-3-2-2",
    toNoteId: "mvp2-note-3-6-2",
  },
  {
    id: "mvp5-tech-slide-down",
    type: "slideDown",
    fromNoteId: "mvp2-note-6-3-1",
    toNoteId: "mvp2-note-6-5-1",
  },
  {
    id: "mvp5-tech-tie",
    type: "tie",
    fromNoteId: "mvp2-note-1-6-6",
    toNoteId: "mvp2-note-1-7-6",
  },
  {
    id: "mvp5-tech-bend",
    type: "bend",
    fromNoteId: "mvp2-note-1-1-6",
    semitones: 2,
  },
  {
    id: "mvp5-tech-vibrato",
    type: "vibrato",
    fromNoteId: "mvp2-note-1-3-5",
  },
  {
    id: "mvp5-tech-natural-harmonic",
    type: "naturalHarmonic",
    fromNoteId: "mvp2-note-1-2-3",
  },
  {
    id: "mvp5-tech-artificial-harmonic",
    type: "artificialHarmonic",
    fromNoteId: "mvp2-note-1-2-2",
  },
  {
    id: "mvp5-tech-tapping",
    type: "tapping",
    fromNoteId: "mvp2-note-1-4-5",
  },
  {
    id: "mvp5-tech-trill",
    type: "trill",
    fromNoteId: "mvp2-note-1-9-5",
    auxiliaryFret: 8,
  },
  {
    id: "mvp5-tech-strum",
    type: "strum",
    beatId: "mvp2-beat-1-2",
    minString: 2,
    maxString: 3,
    stroke: "down",
  },
  {
    id: "mvp5-tech-arpeggio",
    type: "arpeggio",
    beatId: "mvp2-beat-1-5",
    minString: 2,
    maxString: 6,
    direction: "ascending",
  },
  {
    id: "mvp5-tech-pick",
    type: "pickStroke",
    beatId: "mvp2-beat-1-1",
    stroke: "up",
  },
  {
    id: "mvp5-tech-palm-mute",
    type: "palmMute",
    fromBeatId: "mvp2-beat-3-1",
    toBeatId: "mvp2-beat-4-6",
  },
  {
    id: "mvp5-tech-let-ring",
    type: "letRing",
    fromBeatId: "mvp2-beat-5-1",
    toBeatId: "mvp2-beat-8-5",
  },
];

const EXAMPLE_MVP_5: ILXMDocument = {
  ...EXAMPLE_MVP_4,
  score: {
    ...EXAMPLE_MVP_4.score,
    title: "MVP v5 吉他技巧测试",
    meta: { fixture: "mvp-v5" },
    tracks: EXAMPLE_MVP_4.score.tracks.map((track, index) => ({
      ...track,
      techniques: index === 0 ? techniques : [],
    })),
  },
};

export default EXAMPLE_MVP_5;
