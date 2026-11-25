import { layoutParagraphFocus, layoutTabCellCaret, type ILXMLayout } from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "../music-text/music-text-draft";
/** 已有和弦使用真实图元边界；空拍始终回到该 TAB 拍，绝不借简谱位置。 */
export const resolveChordFocus = (layout: ILXMLayout | null, target: MusicTextTarget | null) => {
  if (!layout || target?.kind !== "chord") return null;
  return layout.hitIndex.musicTextBounds?.find((bounds) => bounds.kind === "chord" &&
    bounds.trackId === target.trackId && bounds.measureId === target.measureId && bounds.beatId === target.beatId)
    ?? layoutTabCellCaret(layout, { ...target, string: 1 });
};
/** 原定位入口仍只返回真实歌词，保留已有消费方的 ID 与空值契约。 */
export const resolveLyricFocus = (
  layout: ILXMLayout | null,
  target: MusicTextTarget | null,
) =>
  target?.kind === "lyric"
    ? (layout?.hitIndex.musicTextBounds?.find(
        (r) =>
          !r.empty &&
          r.kind === "lyric" &&
          r.trackId === target.trackId &&
          r.measureId === target.measureId &&
          r.eventId === target.eventId &&
          r.verse === (target.verse ?? 1),
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
  return bounds
    ? {
        ...bounds,
        id: target.eventId ?? String(target.tick),
        kind: target.kind,
      }
    : null;
};
