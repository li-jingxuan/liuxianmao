import type { ILXMLayout } from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

/** 从最终命中几何精确定位当前段歌词；缺词时交由 Beat caret 表达待填写。 */
export const resolveLyricFocus = (
  layout: ILXMLayout | null,
  target: MusicTextTarget | null,
) =>
  target?.kind === "lyric"
    ? (layout?.hitIndex.musicTextBounds?.find(
        (bounds) =>
          bounds.kind === "lyric" &&
          bounds.trackId === target.trackId &&
          bounds.measureId === target.measureId &&
          bounds.beatId === target.beatId &&
          bounds.verse === target.verse,
      ) ?? null)
    : null;
