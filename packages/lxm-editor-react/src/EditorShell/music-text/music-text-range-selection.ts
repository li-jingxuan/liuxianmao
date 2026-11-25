import {
  collectMusicTextRangeSlots,
  hitTestMusicText,
  hitTestNumbered,
  layoutParagraphFocus,
  resolveMusicTextRange,
  type ILXMDocument,
  type ILXMLayout,
  type MusicTextRange,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

export const rangeFromTarget = (target: MusicTextTarget): MusicTextRange | null => {
  if (target.kind === "chord") return null;
  const point = {
    measureId: target.measureId,
    ...(target.eventId ? { eventId: target.eventId } : { tick: target.tick, endTick: target.endTick }),
  };
  return { trackId: target.trackId, kind: target.kind, ...(target.kind === "lyric" ? { verse: target.verse ?? 1 } : {}), anchor: point, focus: point };
};

/** 拖动时只接受起点所在谱层与歌词段，不把 TAB 或连接标记算作范围。 */
export const hitMusicTextRangePoint = (
  layout: ILXMLayout,
  point: { x: number; y: number },
  range: MusicTextRange,
) => {
  if (range.kind === "numbered") {
    const hit = hitTestNumbered(layout, point);
    return hit?.trackId === range.trackId ? rangeFromTarget({ ...hit, kind: "numbered" })?.focus ?? null : null;
  }
  const hit = hitTestMusicText(layout, point);
  return hit?.kind === "lyric" && hit.trackId === range.trackId && (hit.verse ?? 1) === (range.verse ?? 1)
    ? { measureId: hit.measureId, ...(hit.eventId ? { eventId: hit.eventId } : { tick: hit.tick, endTick: hit.endTick }) } : null;
};

export const sameRangePoint = (left: MusicTextRange["focus"], right: MusicTextRange["focus"]) =>
  left.measureId === right.measureId && (left.eventId && right.eventId ? left.eventId === right.eventId : left.tick === right.tick);

/** 使用领域层同一有序位置表，导航跨越小节和排版行。 */
export const navigateMusicTextRange = (
  document: ILXMDocument,
  range: MusicTextRange,
  direction: -1 | 1,
  extend: boolean,
): MusicTextRange | null => {
  const resolved = resolveMusicTextRange(document, range);
  if (!resolved.ok) return null;
  if (!extend && resolved.slots.length > 1) {
    const edge = direction < 0 ? resolved.slots[0]! : resolved.slots.at(-1)!;
    return { ...range, anchor: edge, focus: edge };
  }
  const slots = collectMusicTextRangeSlots(document, range);
  const index = slots.findIndex((slot) => sameRangePoint(slot, range.focus));
  const next = slots[index + direction];
  return index < 0 || !next ? null : { ...range, anchor: extend ? range.anchor : next, focus: next };
};

export const musicTextRangeRects = (document: ILXMDocument, layout: ILXMLayout, range: MusicTextRange) => {
  const resolved = resolveMusicTextRange(document, range);
  return resolved.ok ? resolved.slots.flatMap((slot) => {
    const bounds = layoutParagraphFocus(layout, { ...slot, trackId: range.trackId, kind: range.kind, verse: range.verse ?? 1 });
    return bounds ? [{ ...bounds, key: `${slot.measureId}/${slot.eventId ?? slot.tick}`, focused: sameRangePoint(slot, range.focus) }] : [];
  }) : [];
};
