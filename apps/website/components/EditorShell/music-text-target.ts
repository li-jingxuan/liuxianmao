import type { ILXMDocument, ILXMTabCellReference } from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

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

/** 当前谱行没有布局结果时，至少保留目标小节，避免空数组把四段歌词误判成可新增。 */
export const resolveSystemMeasureIds = (
  measureId: string,
  getSystemMeasureIds: (measureId: string) => string[],
): readonly string[] => {
  const ids = getSystemMeasureIds(measureId).filter(Boolean);
  return ids.includes(measureId) ? ids : [measureId, ...ids];
};
