/**
 * MVP v4 规范测试谱例。
 *
 * v4 继承 v2/v3 已覆盖的八小节复杂节奏，只对少量 Beat 做不可变替换，从而增加
 * rest、空单元格和高品位场景，同时保留所有跨小节/跨 system 测试所需的稳定 ID。
 */
import type { ILXMDocument } from "../src";
import EXAMPLE_MVP_2 from "./example-mvp2.json";

const EXAMPLE_MVP_4: ILXMDocument = {
  ...EXAMPLE_MVP_2,
  score: {
    ...EXAMPLE_MVP_2.score,
    title: "MVP v4 范围输入与安全历史测试",
    meta: { fixture: "mvp-v4" },
    tracks: EXAMPLE_MVP_2.score.tracks.map((track, trackIndex) => ({
      ...track,
      measures: track.measures.map((measure, measureIndex) => ({
        ...measure,
        beats: measure.beats.map((beat, beatIndex) => {
          // 第二小节第二拍作为真正的 rest，覆盖批量写入时的自动 notes 转换。
          if (trackIndex === 0 && measureIndex === 1 && beatIndex === 1)
            return { ...beat, kind: "rest", notes: [] };

          // 第八小节首拍保留一个 24 品音符，覆盖最大合法品位及覆盖 no-op。
          if (trackIndex === 0 && measureIndex === 7 && beatIndex === 0) {
            const firstNote = beat.notes[0];
            return firstNote
              ? {
                  ...beat,
                  notes: [{ ...firstNote, fret: 24 }, ...beat.notes.slice(1)],
                }
              : beat;
          }
          return beat;
        }),
      })),
    })),
  },
};

export default EXAMPLE_MVP_4;
