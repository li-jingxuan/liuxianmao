import source from "./example-technique-rhythm";
import { pruneInvalidTechniques } from "../src/core/technique-rules";
import type { ILXMDocument } from "../src/core/types";

/** 独立混合谱不改原 14 小节；保留附点、休止、三连音与可组合的整拍/范围技巧。 */
const createMutedNoteDocument = (): ILXMDocument => {
  const document = structuredClone(source);
  document.score.id = "muted-note-test-score";
  document.score.title = "闷音 x 与混合时值测试谱";
  const track = document.score.tracks[0]!;
  track.measures = [0, 2, 5, 8, 10, 11].map((index) => track.measures[index]!);
  const labels = [
    "全音符闷音 x",
    "数字与 x：连接中断",
    "拨片方向与 x",
    "附点：P.M. 混合闷音",
    "三连音与 x",
    "扫弦、琶音与 x 和弦",
  ];
  track.measures.forEach((measure, index) => {
    measure.lyrics.forEach((lyric) => {
      lyric.text = labels[index]!;
    });
    measure.beats.forEach((beat, beatIndex) => {
      beat.notes.forEach((note, noteIndex) => {
        if (index === 0 || (beatIndex === 0 && noteIndex === 0))
          note.fret = "x";
      });
    });
  });
  // 本谱有意改变音高语义；旧连接或音高技巧须按正式规则清理。
  document.score.tracks = [pruneInvalidTechniques(track)];
  return document;
};

export default createMutedNoteDocument();
