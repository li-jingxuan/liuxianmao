import {
  getMeasureCapacityTicks,
  planLyricPositions,
  resolveLyricPosition,
  type ILXMDocument,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import { resolveNumberedEditorTarget } from "./numbered-editor-target";

export type ParagraphInsertionTarget = {
  trackId: string;
  measureId: string;
  eventId?: string;
  tick?: number;
  endTick?: number;
};

/** 从选中的音符或空时间窗开始；首次添加时可使用当前小节的第一个歌词位置。 */
export const resolveParagraphInsertionTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
): ParagraphInsertionTarget | null => {
  if (!document) return null;
  const track =
    document.score.tracks.find((item) => item.id === preferred?.trackId) ??
    (!preferred ? document.score.tracks[0] : undefined);
  const measure =
    track?.measures.find((item) => item.id === preferred?.measureId) ??
    (!preferred ? track?.measures[0] : undefined);
  if (!track || !measure) return null;
  const position =
    preferred &&
    (("eventId" in preferred && preferred.eventId) ||
      ("tick" in preferred && preferred.tick !== undefined))
      ? resolveLyricPosition(measure, preferred)
      : planLyricPositions(measure)[0];
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

/** 布局未就绪不能猜测谱行；返回 null 由入口解释，避免误建第五段。 */
export const resolveSystemMeasureIds = (
  measureId: string,
  getSystemMeasureIds: (measureId: string) => string[],
): readonly string[] | null => {
  const ids = getSystemMeasureIds(measureId).filter(Boolean);
  return ids.includes(measureId) ? ids : null;
};

/** 独立简谱不依赖 TAB Beat；只打开真实事件或合法空白时间窗。 */
export const resolveParagraphNumberedTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
): MusicTextTarget | null => {
  if (!document) return null;
  const resolved = resolveNumberedEditorTarget(document, preferred);
  if (resolved) return { ...resolved, kind: "numbered" };
  const track = document.score.tracks[0];
  const measure = track?.measures[0];
  if (!track || !measure) return null;
  const event = measure.numberedVoice.events[0];
  return event
    ? {
        kind: "numbered",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        itemId: event.items[0]?.id,
      }
    : {
        kind: "numbered",
        trackId: track.id,
        measureId: measure.id,
        tick: 0,
        endTick: Math.min(960, getMeasureCapacityTicks(measure.timeSignature)),
      };
};
