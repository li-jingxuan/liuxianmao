import {
  musicTextGlyph,
  musicTextInkBounds,
  musicTextRequest,
  numberedAccidentalMeasureRequest,
  unionMusicBounds,
  MUSIC_TEXT_LANE_GAP,
  MUSIC_TEXT_PLACEHOLDER_HEIGHT,
  MUSIC_TEXT_PLACEHOLDER_WIDTH,
  type ILXMMusicTextMetrics,
  type MusicTextGlyph,
  type MusicTextRect,
} from "./music-text-metrics";
import type { ILXMLayout } from "./layout-types";
import { getMeasureContentBottom } from "./rhythm-bounds";
import { numberedXAtTick } from "./numbered-input-layout";
import { layoutLyricPlaceholder } from "./lyric-placeholder-layout";
import {
  numberedLayoutProfile,
  type NumberedLayoutProfile,
} from "./numbered-layout-profile";
export interface NumberedLayout {
  eventId: string;
  itemBounds?: { itemId: string; bounds: MusicTextRect }[];
  labels: MusicTextGlyph[];
  dots: { cx: number; cy: number; r: number }[];
  lines?: {
    x1: number;
    x2: number;
    y: number;
    thickness: number;
    shared?: boolean;
  }[];
  rhythmDots?: { cx: number; cy: number; r: number }[];
  bounds: MusicTextRect;
}
/** 升降号使用已打包音乐字体，数字与记号各自度量。 */
export const numberedAccidentalRequest = numberedAccidentalMeasureRequest;
/** 八度后缀投影为真实圆点，完整多音组横向度量只在核心计算。 */
export const layoutNumbered = (
  eventId: string,
  tokens: readonly string[],
  x: number,
  y: number,
  metrics?: ILXMMusicTextMetrics,
  profile: NumberedLayoutProfile = numberedLayoutProfile(),
): NumberedLayout => {
  const raw = tokens.map((token) => {
    const suffix = token.match(/['.]+$/)?.[0] ?? "";
    const prefix = token.match(/^[#bn]/)?.[0];
    const body = token.slice(prefix ? 1 : 0, token.length - suffix.length);
    const glyph = musicTextGlyph(musicTextRequest(body, 14), 0, 0, metrics);
    return {
      suffix,
      prefix,
      body,
      // 多音组按真实数字宽度排布，保护边界不能在每项之间重复叠加。
      width:
        Math.max(
          profile.purpose === "editing" ? 10 : 8,
          musicTextInkBounds(glyph).width,
        ) + (prefix ? 8 : 0),
    };
  });
  const width =
    raw.reduce((s, r) => s + r.width, 0) +
    Math.max(0, raw.length - 1) * profile.itemGap;
  // 同一时刻的多音组以首个数字为起音锚点，后续数字只向右展开。
  let left =
    raw.length > 1
      ? x - raw[0]!.width / 2 - (raw[0]!.prefix ? 4 : 0)
      : x - width / 2;
  const labels: MusicTextGlyph[] = [],
    dots: NumberedLayout["dots"] = [];
  for (const r of raw) {
    const center =
      raw.length === 1 ? x : left + r.width / 2 + (r.prefix ? 4 : 0);
    const g = musicTextGlyph(musicTextRequest(r.body, 14), center, y, metrics);
    labels.push(g);
    if (r.prefix) {
      const raw = musicTextGlyph(
        numberedAccidentalRequest(r.prefix),
        g.bounds.x - 5,
        0,
        metrics,
      );
      const inkHeight = Math.max(1, raw.bounds.height - 4),
        digitHeight = Math.max(1, g.bounds.height - 4);
      const scale = Math.min(1, digitHeight / inkHeight);
      const baseline =
        g.bounds.y +
        2 +
        (digitHeight - inkHeight * scale) / 2 -
        (raw.bounds.y + 2) * scale;
      // 用实际墨迹等比缩放并垂直居中，字号与渲染包围框同步，不能只裁掉字体框。
      labels.push({
        ...raw,
        fontSize: raw.fontSize * scale,
        y: baseline,
        bounds: {
          x: raw.x + (raw.bounds.x - raw.x + 2) * scale - 2,
          y: baseline + (raw.bounds.y + 2) * scale - 2,
          width: (raw.bounds.width - 4) * scale + 4,
          height: inkHeight * scale + 4,
        },
      });
    }
    for (let i = 0; i < r.suffix.length; i++)
      dots.push({
        cx: center,
        cy:
          r.suffix[0] === "'"
            ? musicTextInkBounds(g).y -
              profile.octaveGap -
              1.3 -
              i * (2.6 + profile.octaveStackGap)
            : g.bounds.y + g.bounds.height + 4 + i * 4,
        r: 1.3,
      });
    left += r.width + profile.itemGap;
  }
  return {
    eventId,
    labels,
    dots,
    bounds: unionMusicBounds([
      ...labels.map((g) => g.bounds),
      ...dots.map((d) => ({
        x: d.cx - d.r,
        y: d.cy - d.r,
        width: 2 * d.r,
        height: 2 * d.r,
      })),
    ]),
  };
};
export const translateNumbered = (
  n: NumberedLayout,
  dy: number,
): NumberedLayout => ({
  ...n,
  labels: n.labels.map((g) => ({
    ...g,
    y: g.y + dy,
    bounds: { ...g.bounds, y: g.bounds.y + dy },
  })),
  dots: n.dots.map((d) => ({ ...d, cy: d.cy + dy })),
  lines: n.lines?.map((l) => ({ ...l, y: l.y + dy })),
  rhythmDots: n.rhythmDots?.map((d) => ({ ...d, cy: d.cy + dy })),
  itemBounds: n.itemBounds?.map((i) => ({
    ...i,
    bounds: { ...i.bounds, y: i.bounds.y + dy },
  })),
  bounds: { ...n.bounds, y: n.bounds.y + dy },
});
/** 焦点优先消费文本单元格；未启用编辑区域时兼容旧的临时位置。 */
export const layoutParagraphFocus = (
  layout: ILXMLayout,
  target: {
    trackId: string;
    measureId: string;
    beatId?: string;
    eventId?: string;
    itemId?: string;
    tick?: number;
    endTick?: number;
    kind: "lyric" | "numbered";
    verse?: number;
  },
): MusicTextRect | null => {
  if (layout.trackId !== target.trackId) return null;
  if (target.kind === "numbered") {
    const m = layout.systems
      .flatMap((s) => s.measures)
      .find((m) => m.id === target.measureId);
    if (!m) return null;
    const slot = m.numberedInputSlots?.find((s) =>
      target.eventId
        ? s.target.kind === "numberedEvent" &&
          s.target.eventId === target.eventId
        : s.startTick === target.tick && s.endTick === target.endTick,
    );
    if (slot)
      return {
        x: slot.anchorX - Math.max(24, slot.width) / 2,
        y: slot.y,
        width: Math.max(24, slot.width),
        height: slot.height,
      };
    const existing =
      target.eventId &&
      m.numberedNotation?.find((n) => n.eventId === target.eventId);
    if (existing) {
      const sourceSlot = m.numberedSlots.find((s) => s.id === target.eventId);
      const tabBeat =
        sourceSlot &&
        m.beats.find(
          (beat) =>
            sourceSlot.x >= beat.x - 0.001 &&
            sourceSlot.x < beat.x + beat.width - 0.001,
        );
      // 一拍中的多个独立事件共用视觉激活框，命中索引仍保留每个 item 的身份。
      const grouped = tabBeat
        ? (m.numberedNotation ?? []).filter((notation) => {
            const eventSlot = m.numberedSlots.find(
              (s) => s.id === notation.eventId,
            );
            return (
              eventSlot &&
              eventSlot.x >= tabBeat.x - 0.001 &&
              eventSlot.x < tabBeat.x + tabBeat.width - 0.001
            );
          })
        : [];
      const bounds = grouped.length
        ? {
            x: Math.min(...grouped.map((n) => n.bounds.x)),
            y: Math.min(...grouped.map((n) => n.bounds.y)),
            width:
              Math.max(...grouped.map((n) => n.bounds.x + n.bounds.width)) -
              Math.min(...grouped.map((n) => n.bounds.x)),
            height:
              Math.max(...grouped.map((n) => n.bounds.y + n.bounds.height)) -
              Math.min(...grouped.map((n) => n.bounds.y)),
          }
        : (existing.itemBounds?.find((i) => i.itemId === target.itemId)
            ?.bounds ?? existing.bounds);
      return {
        x: bounds.x - 4,
        y: bounds.y - 2,
        width: bounds.width + 8,
        height: bounds.height + 4,
      };
    }
    const row = layout.systems.find((s) =>
      s.measures.some((x) => x.id === m.id),
    )!;
    const y =
      row.numberedRow?.y ??
      Math.max(...row.measures.map(getMeasureContentBottom)) +
        MUSIC_TEXT_LANE_GAP;
    const anchor =
      (target.tick !== undefined
        ? numberedXAtTick(m, target.tick)
        : undefined) ??
      m.beats.find((b) => b.id === target.beatId)?.x ??
      m.x + 18;
    return { x: anchor - 12, y, width: 24, height: 18 };
  }

  for (const s of layout.systems) {
    const m = s.measures.find((m) => m.id === target.measureId);
    if (!m) continue;
    if (!target.eventId) {
      const cell = s.musicTextCells?.find(
        (cell) =>
          cell.measureId === m.id &&
          cell.kind === "lyric" &&
          cell.tick === target.tick &&
          cell.endTick === target.endTick &&
          cell.verse === (target.verse ?? 1),
      );
      if (!cell) return null;
      if (cell.eventId)
        return layoutParagraphFocus(layout, {
          ...target,
          eventId: cell.eventId,
        });
      const anchorX = cell.anchorX ?? numberedXAtTick(m, target.tick!);
      return {
        x: anchorX - MUSIC_TEXT_PLACEHOLDER_WIDTH / 2,
        y: cell.y,
        width: MUSIC_TEXT_PLACEHOLDER_WIDTH,
        height: Math.max(MUSIC_TEXT_PLACEHOLDER_HEIGHT, cell.height),
      };
    }
    const slot = m?.numberedSlots.find(
      (slot) =>
        slot.id === target.eventId &&
        (slot.kind === "notes" || slot.kind === "gap"),
    );
    if (!m || !slot) continue;
    const existing = layout.hitIndex.musicTextBounds?.find(
      (r) =>
        !r.empty &&
        r.measureId === m.id &&
        r.eventId === slot.id &&
        r.kind === target.kind &&
        (target.kind !== "lyric" || r.verse === (target.verse ?? 1)),
    );
    if (existing) {
      // 已有文字同样保留最小编辑宽度；仅扩展视觉焦点，不改变拍点或命中边界。
      const width = Math.max(MUSIC_TEXT_PLACEHOLDER_WIDTH, existing.width + 8);
      return {
        x: existing.x + existing.width / 2 - width / 2,
        y: existing.y - 2,
        width,
        height: existing.height + 4,
      };
    }
    const cell = s.musicTextCells?.find(
      (c) =>
        c.measureId === m.id &&
        c.eventId === slot.id &&
        c.kind === target.kind &&
        (target.kind !== "lyric" || c.verse === (target.verse ?? 1)),
    );
    if (cell) {
      // 焦点与空占位共用音符中心；窄格仅扩展视觉焦点，不扩展命中范围。
      const placeholder = layoutLyricPlaceholder(cell, slot.x);
      const width = Math.max(MUSIC_TEXT_PLACEHOLDER_WIDTH, placeholder.width);
      return {
        x: slot.x - width / 2,
        y: cell.y,
        width,
        height: Math.max(MUSIC_TEXT_PLACEHOLDER_HEIGHT, cell.height),
      };
    }
    const row = s.measures
      .flatMap((m) => m.lyrics ?? [])
      .find((l) => l.verse === (target.verse ?? 1))?.bounds;
    const y =
      row?.y ?? Math.min(s.y + s.height - 20, m.strings.at(-1)!.y1 + 22);
    return {
      x: slot.x - MUSIC_TEXT_PLACEHOLDER_WIDTH / 2,
      y: Math.max(
        s.y,
        Math.min(y, s.y + s.height - MUSIC_TEXT_PLACEHOLDER_HEIGHT),
      ),
      width: MUSIC_TEXT_PLACEHOLDER_WIDTH,
      height: MUSIC_TEXT_PLACEHOLDER_HEIGHT,
    };
  }
  return null;
};
