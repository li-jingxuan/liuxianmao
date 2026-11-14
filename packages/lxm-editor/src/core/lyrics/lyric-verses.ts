import type { ILXMDocument, ILXMLyricVerse } from "../types";

/** 段落属于整份曲谱；旧文档从已有歌词推断，空段由附加元数据保留。 */
export const getLyricVerseCount = (document: ILXMDocument): ILXMLyricVerse => {
  const stored = document.score.meta.lyricVerseCount;
  let count = typeof stored === "number" && Number.isInteger(stored) &&
    stored >= 1 && stored <= 4 ? stored : 1;
  for (const track of document.score.tracks)
    for (const measure of track.measures)
      for (const lyric of measure.lyrics)
        count = Math.max(count, lyric.verse);
  return count as ILXMLyricVerse;
};
