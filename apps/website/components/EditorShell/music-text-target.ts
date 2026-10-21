import {
  getMeasureCapacityTicks,
  type ILXMDocument,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import { resolveNumberedEditorTarget } from "./numbered-editor-target";

export type ParagraphInsertionTarget = ILXMTabCellReference;

/**
 * 解析新增歌词/简谱行的真实起点：优先使用当前有效目标，避免误落到首轨；
 * 没有目标时才回退到第一条含有拍点的轨道。
 */
export const resolveParagraphInsertionTarget = (
  document: ILXMDocument | null,
  preferred: MusicTextTarget | ILXMTabCellReference | null,
): ParagraphInsertionTarget | null => {
  if (!document) return null;
  if (preferred) {
    const track = document.score.tracks.find(
      (item) => item.id === preferred.trackId,
    );
    const measure = track?.measures.find(
      (item) => item.id === preferred.measureId,
    );
    const beat = measure?.beats.find((item) => item.id === preferred.beatId);
    if (track && measure && beat)
      return {
        trackId: track.id,
        measureId: measure.id,
        beatId: beat.id,
        string: preferred.string ?? 1,
      };
  }
  for (const track of document.score.tracks) {
    const measure = track.measures.find((item) => item.beats.length > 0);
    const beat = measure?.beats[0];
    if (measure && beat)
      return {
        trackId: track.id,
        measureId: measure.id,
        beatId: beat.id,
        string: 1,
      };
  }
  return null;
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
