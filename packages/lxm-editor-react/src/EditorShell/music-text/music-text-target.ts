import {
  createNumberedTrackRhythmContext,
  getLyricVerseCount,
  planLyricPositions,
  resolveLyricPosition,
  type ILXMDocument,
  type ILXMTabCellReference,
  type ILXMLyricVerse,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

export type ParagraphInsertionTarget = {
  trackId: string;
  measureId: string;
  eventId?: string;
  tick?: number;
  endTick?: number;
};

/** 页签切换只解析当前显式位置，不寻找相邻可写歌词的音符。 */
export const resolveParagraphLyricTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
  verse: number = 1,
): Extract<MusicTextTarget, { kind: "lyric" }> | null => {
  const position = resolveParagraphInsertionTarget(document, preferred);
  if (!document || !position) return null;
  return {
    ...position,
    kind: "lyric",
    verse: (Number.isInteger(verse) && verse >= 1 && verse <= getLyricVerseCount(document)
      ? verse : 1) as ILXMLyricVerse,
  };
};

/** 只使用显式歌词事件或合法空窗；无来源时不猜测首小节或首个歌词位置。 */
export const resolveParagraphInsertionTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
): ParagraphInsertionTarget | null => {
  if (!document || !preferred || !("kind" in preferred) || preferred.kind === "chord") return null;
  const track = document.score.tracks.find((item) => item.id === preferred.trackId);
  const measure = preferred.eventId
    ? track?.measures.find((item) => item.numberedVoice.events.some((event) => event.id === preferred.eventId))
    : track?.measures.find((item) => item.id === preferred.measureId);
  if (!track || !measure) return null;
  const position = preferred.eventId || preferred.tick !== undefined
    ? resolveLyricPosition(measure, preferred, createNumberedTrackRhythmContext(track)) : null;
  if (position)
    return {
      trackId: track.id,
      measureId: measure.id,
      ...(position.eventId
        ? { eventId: position.eventId }
        : { tick: position.tick, endTick: position.endTick }),
    };
  return null;
};

/** 单词应用后沿简谱音符时间顺序前进，休止与 TAB 拍点均不占歌词位置。 */
export const resolveNextLyricTarget = (
  document: ILXMDocument,
  target: Extract<MusicTextTarget, { kind: "lyric" }>,
): Extract<MusicTextTarget, { kind: "lyric" }> | null => {
  const track = document.score.tracks.find(
    (item) => item.id === target.trackId,
  );
  if (!track) return null;
  const rhythm = createNumberedTrackRhythmContext(track);
  const events: Omit<ParagraphInsertionTarget, "trackId">[] =
    track.measures.flatMap((measure) =>
      planLyricPositions(measure, rhythm).map((position) => ({
        measureId: measure.id,
        ...(position.eventId
          ? { eventId: position.eventId }
          : { tick: position.tick, endTick: position.endTick }),
      })),
    );
  const current = resolveParagraphInsertionTarget(document, target);
  const index = events.findIndex(
    (event) =>
      current && event.measureId === current.measureId &&
      (current.eventId ? event.eventId === current.eventId : event.tick === current.tick),
  );
  const next = index >= 0 ? events[index + 1] : undefined;
  return next
    ? { kind: "lyric", trackId: target.trackId, verse: target.verse, ...next }
    : null;
};
