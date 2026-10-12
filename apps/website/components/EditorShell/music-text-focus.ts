import { layoutParagraphFocus, type ILXMLayout } from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
/** 原定位入口仍只返回真实歌词，保留已有消费方的 ID 与空值契约。 */
export const resolveLyricFocus = (
  layout: ILXMLayout | null,
  target: MusicTextTarget | null,
) =>
  target?.kind === "lyric"
    ? (layout?.hitIndex.musicTextBounds?.find(
        (r) =>
          r.kind === "lyric" &&
          r.trackId === target.trackId &&
          r.measureId === target.measureId &&
          r.beatId === target.beatId &&
          r.verse === target.verse,
      ) ?? null)
    : null;
/** 子 TAB 使用扩展入口，空内容高亮仅为临时 overlay。 */
export const resolveParagraphFocus = (
  layout: ILXMLayout | null,
  target: MusicTextTarget | null,
) => {
  if (
    !layout ||
    !target ||
    (target.kind !== "lyric" && target.kind !== "numbered")
  )
    return null;
  const bounds = layoutParagraphFocus(layout, { ...target, kind: target.kind });
  return bounds ? { ...bounds, id: target.beatId, kind: target.kind } : null;
};
