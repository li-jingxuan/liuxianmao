import { getVisibleLyricVerseCount } from "../lyrics/lyric-verses";
import type { ILXMDocument, ILXMMeasure, ILXMLyricVerse, ILXMTrack } from "../types";

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

export const clearNumberedRow = (track: ILXMTrack): ILXMTrack => {
  const anchorIds = new Set(track.measures.flatMap(measure => measure.lyrics.map(lyric => lyric.eventId)));
  const tuplets = track.measures.flatMap(measure =>
    measure.numberedVoice.tuplets.filter(group => group.eventIds.some(id => anchorIds.has(id))),
  );
  const keptGroups = new Set(tuplets);
  // 有歌词的连音需要保留整个组及实际时长，即使歌词锚点位于次小节。
  for (const group of tuplets) for (const id of group.eventIds) anchorIds.add(id);
  return {
    ...track,
    numberedMarks: [],
    measures: track.measures.map(measure => {
      const events = measure.numberedVoice.events
        .filter(event => anchorIds.has(event.id))
        .map(event => event.kind === "gap" ? event : { ...event, kind: "gap" as const, items: [] as [] });
      return { ...measure, numberedVoice: { events, tuplets: measure.numberedVoice.tuplets.filter(group => keptGroups.has(group)) } };
    }),
  };
};

export const removeLyricVerse = (measure: ILXMMeasure, verse: ILXMLyricVerse): ILXMMeasure => {
  if (measure.lyrics.every((lyric) => lyric.verse < verse)) return measure;
  const lyrics = measure.lyrics.filter((lyric) => lyric.verse !== verse).map((lyric) =>
    lyric.verse < verse ? lyric : { ...lyric, verse: (lyric.verse - 1) as ILXMLyricVerse },
  );
  return { ...measure, lyrics };
};
