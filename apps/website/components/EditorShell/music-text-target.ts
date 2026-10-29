import {
  getMeasureCapacityTicks,
  type ILXMDocument,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import { resolveNumberedEditorTarget } from "./numbered-editor-target";

export type ParagraphInsertionTarget = {
  trackId: string;
  measureId: string;
  eventId: string;
};

/** 歌词只能从当前选中的简谱音符事件开始，不能由 TAB 或空白窗口推断。 */
export const resolveParagraphInsertionTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
): ParagraphInsertionTarget | null => {
  if (
    !document ||
    !preferred ||
    !("eventId" in preferred) ||
    !preferred.eventId
  )
    return null;
  const track = document.score.tracks.find(
    (item) => item.id === preferred.trackId,
  );
  const measure = track?.measures.find(
    (item) => item.id === preferred.measureId,
  );
  const event = measure?.numberedVoice.events.find(
    (item) => item.id === preferred.eventId,
  );
  if (track && measure && event?.kind === "notes")
    return { trackId: track.id, measureId: measure.id, eventId: event.id };
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
  const events =
    track?.measures.flatMap((measure) =>
      measure.numberedVoice.events
        .filter((event) => event.kind === "notes")
        .slice()
        .sort((a, b) => a.tick - b.tick)
        .map((event) => ({ measureId: measure.id, eventId: event.id })),
    ) ?? [];
  const index = events.findIndex(
    (event) =>
      event.measureId === target.measureId && event.eventId === target.eventId,
  );
  const next = index >= 0 ? events[index + 1] : undefined;
  return next ? { ...target, ...next } : null;
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
