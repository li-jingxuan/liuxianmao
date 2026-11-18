import { getVisibleLyricVerseCount } from "../lyrics/lyric-verses";
import type { ILXMDocument } from "../types";

/** 空简谱事件也用于承载拍位和歌词，只有正式记谱或显式添加才开启简谱行。 */
export const getMusicTextRows = (document: ILXMDocument) => {
  const track = document.score.tracks[0];
  return {
    numbered: document.score.meta.showNumberedRow === true || !!track?.measures.some(
      (measure) => measure.numberedVoice.events.some((event) => event.kind !== "gap"),
    ),
    lyricVerses: getVisibleLyricVerseCount(document),
  };
};
