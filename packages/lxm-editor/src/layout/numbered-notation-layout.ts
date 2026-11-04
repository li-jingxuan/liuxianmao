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
import type { ILXMLayout, ILXMMeasureLayout } from "./layout-types";
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
export interface ParagraphFocusTarget {
  trackId: string;
  measureId: string;
  beatId?: string;
  eventId?: string;
  itemId?: string;
  tick?: number;
  endTick?: number;
  kind: "lyric" | "numbered";
  verse?: number;
}

const paragraphMeasure = (
  layout: ILXMLayout,
  target: Pick<ParagraphFocusTarget, "trackId" | "measureId">,
): ILXMMeasureLayout | undefined =>
  layout.trackId === target.trackId
    ? layout.systems
        .flatMap((s) => s.measures)
        .find((m) => m.id === target.measureId)
    : undefined;

const padNumberedBounds = (bounds: MusicTextRect): MusicTextRect => ({
  x: bounds.x - 4,
  y: bounds.y - 2,
  width: bounds.width + 8,
  height: bounds.height + 4,
});

/** 同拍归属沿用 TAB 拍的横向区间；导航顺序只由简谱 slot tick 决定。 */
const numberedEventsInTabBeat = (
  measure: ILXMMeasureLayout,
  eventId: string | undefined,
): NumberedLayout[] => {
  const sourceSlot = measure.numberedSlots.find((s) => s.id === eventId);
  const tabBeat =
    sourceSlot &&
    measure.beats.find(
      (beat) =>
        sourceSlot.x >= beat.x - 0.001 &&
        sourceSlot.x < beat.x + beat.width - 0.001,
    );
  if (!tabBeat) return [];
  const notationById = new Map(
    measure.numberedNotation?.map((n) => [n.eventId, n]),
  );
  if (!eventId || !notationById.has(eventId)) return [];
  return measure.numberedSlots
    .filter(
      (slot) =>
        slot.x >= tabBeat.x - 0.001 &&
        slot.x < tabBeat.x + tabBeat.width - 0.001,
    )
    .sort((a, b) => a.tick - b.tick)
    .flatMap((slot) => notationById.get(slot.id) ?? []);
};

/** 多事件 TAB 拍的淡底与导航上下文；单事件、空输入槽和歌词没有拍背景。 */
export const layoutNumberedBeatContext = (
  layout: ILXMLayout,
  target: Omit<ParagraphFocusTarget, "kind"> & {
    kind?: ParagraphFocusTarget["kind"];
  },
): { bounds: MusicTextRect; eventIds: string[] } | null => {
  if (target.kind === "lyric") return null;
  const measure = paragraphMeasure(layout, target);
  if (!measure) return null;
  const events = numberedEventsInTabBeat(measure, target.eventId);
  if (events.length <= 1) return null;
  return {
    bounds: padNumberedBounds(unionMusicBounds(events.map((n) => n.bounds))),
    eventIds: events.map((n) => n.eventId),
  };
};

/** 焦点优先消费文本单元格；未启用编辑区域时兼容旧的临时位置。 */
export const layoutParagraphFocus = (
  layout: ILXMLayout,
  target: ParagraphFocusTarget,
): MusicTextRect | null => {
  if (layout.trackId !== target.trackId) return null;
  if (target.kind === "numbered") {
    const m = paragraphMeasure(layout, target);
    if (!m) return null;
    const existing =
      target.eventId &&
      m.numberedNotation?.find((n) => n.eventId === target.eventId);
    if (existing)
      return padNumberedBounds(
        existing.itemBounds?.find((i) => i.itemId === target.itemId)?.bounds ??
          existing.bounds,
      );
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
