import {
  planLyricPositions,
  resolveLyricPosition,
  type ILXMDocument,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

export type ParagraphInsertionTarget = {
  trackId: string;
  measureId: string;
  eventId?: string;
  tick?: number;
  endTick?: number;
};

/** 只使用显式歌词事件或合法空窗；无来源时不猜测首小节或首个歌词位置。 */
export const resolveParagraphInsertionTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
): ParagraphInsertionTarget | null => {
  if (!document || !preferred || !("kind" in preferred) || preferred.kind === "chord") return null;
  const track = document.score.tracks.find((item) => item.id === preferred.trackId);
  const measure = track?.measures.find((item) => item.id === preferred.measureId);
  if (!track || !measure) return null;
  const position = preferred.eventId || preferred.tick !== undefined
    ? resolveLyricPosition(measure, preferred) : null;
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
  const events: Omit<ParagraphInsertionTarget, "trackId">[] =
    track?.measures.flatMap((measure) =>
      planLyricPositions(measure).map((position) => ({
        measureId: measure.id,
        ...(position.eventId
          ? { eventId: position.eventId }
          : { tick: position.tick, endTick: position.endTick }),
      })),
    ) ?? [];
  const measure = track?.measures.find(
    (measure) => measure.id === target.measureId,
  );
  const position = measure && resolveLyricPosition(measure, target);
  const index = events.findIndex(
    (event) =>
      event.measureId === target.measureId &&
      position &&
      (position.eventId
        ? event.eventId === position.eventId
        : event.tick === position.tick),
  );
  const next = index >= 0 ? events[index + 1] : undefined;
  return next
    ? { kind: "lyric", trackId: target.trackId, verse: target.verse, ...next }
    : null;
};
