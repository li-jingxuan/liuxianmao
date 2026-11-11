import {
  hitTestNumbered,
  hitTestNumberedMark,
  hitTestMusicText,
  type ILXMLayout,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

/** 悬停与点击保持简谱对象优先级，hover 只返回稳定业务目标，不依赖 TAB 拍序列。 */
export const resolveMusicTextHoverTarget = (
  layout: ILXMLayout,
  point: { x: number; y: number },
): MusicTextTarget | null => {
  const mark = hitTestNumberedMark(layout, point);
  if (mark) return { ...mark.target, kind: "numbered" };
  const numbered = hitTestNumbered(layout, point);
  if (numbered) return { ...numbered, kind: "numbered" };
  const text = hitTestMusicText(layout, point);
  return text?.kind === "lyric" && (text.eventId || text.tick !== undefined)
    ? {
        kind: "lyric",
        trackId: text.trackId,
        measureId: text.measureId,
        ...(text.eventId
          ? { eventId: text.eventId }
          : { tick: text.tick, endTick: text.endTick }),
        verse: text.verse,
      }
    : null;
};

/** 简谱比较真实事件或完整时间窗口，不能用两个 undefined beatId 判定为同一目标。 */
export const sameMusicTextTarget = (
  a: MusicTextTarget | null,
  b: MusicTextTarget | null,
): boolean => {
  if (!a || !b) return a === b;
  if (
    a.kind !== b.kind ||
    a.trackId !== b.trackId ||
    a.measureId !== b.measureId
  )
    return false;
  if (a.kind === "numbered" && b.kind === "numbered")
    return a.eventId || b.eventId
      ? a.eventId === b.eventId && a.itemId === b.itemId
      : a.tick === b.tick && a.endTick === b.endTick;
  if (a.kind === "lyric" && b.kind === "lyric")
    return (
      (a.eventId || b.eventId
        ? a.eventId === b.eventId
        : a.tick === b.tick && a.endTick === b.endTick) &&
      (a.verse ?? 1) === (b.verse ?? 1)
    );
  return a.kind === "chord" && b.kind === "chord" && a.beatId === b.beatId;
};
