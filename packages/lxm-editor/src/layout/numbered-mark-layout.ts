import { buildNumberedIndex } from "../core/numbered-rhythm";
import type { ILXMTrack } from "../core/types";
import type { ILXMSystemLayout } from "./layout-types";
import type { NumberedLayout } from "./numbered-notation-layout";
import {
  numberedLayoutProfile,
  type NumberedLayoutProfile,
} from "./numbered-layout-profile";
import {
  musicTextGlyph,
  musicTextInkBounds,
  musicTextRequest,
  unionMusicBounds,
  type MusicTextGlyph,
  type MusicTextRect,
  type ILXMMusicTextMetrics,
} from "./music-text-metrics";
export interface NumberedMarkLayout {
  markId: string;
  type: "tie" | "slur" | "fermata" | "tuplet" | "structure";
  path?: { d: string; strokeWidth: number };
  lines: { x1: number; x2: number; y: number; thickness: number }[];
  dots: { cx: number; cy: number; r: number }[];
  labels: MusicTextGlyph[];
  bounds: MusicTextRect;
  target?: { measureId: string; eventId: string };
}
/** 独立简谱连接按谱行拆段，音符 ID 保持为同一领域关系。 */
export const layoutNumberedMarks = (
  track: ILXMTrack,
  system: ILXMSystemLayout,
  frames: NumberedLayout[],
  metrics?: ILXMMusicTextMetrics,
  index = buildNumberedIndex(track),
  profile: NumberedLayoutProfile = numberedLayoutProfile(),
): NumberedMarkLayout[] => {
  const measureIndices = system.measures.map((m) =>
    track.measures.findIndex((s) => s.id === m.id),
  );
  const lo = Math.min(...measureIndices),
    hi = Math.max(...measureIndices);
  const byEvent = new Map(frames.map((f) => [f.eventId, f]));
  const slots = new Map(
    system.measures.flatMap((m) =>
      m.numberedSlots.map((s) => [s.id, s] as const),
    ),
  );
  const left = system.measures[0]!.x + 8,
    right = system.measures.at(-1)!.x + system.measures.at(-1)!.width - 8;
  const results: NumberedMarkLayout[] = [];
  const obstacles = (x1: number, x2: number) =>
    [
      ...frames.flatMap((f) => [
        ...f.labels.map(musicTextInkBounds),
        ...[...f.dots, ...(f.rhythmDots ?? [])].map((d) => ({
          x: d.cx - d.r,
          y: d.cy - d.r,
          width: d.r * 2,
          height: d.r * 2,
        })),
      ]),
      ...results.map((r) => r.bounds),
    ].filter((b) => b.x < x2 + 1 && b.x + b.width > x1 - 1);
  /** 只避让横向相交的内容，远处高八度点不会抬高本连线。 */
  const allocate = (x1: number, x2: number, bottom = 1) =>
    Math.min(...obstacles(x1, x2).map((b) => b.y), -8) -
    profile.markGap -
    bottom;
  const markPosition = (mark: ILXMTrack["numberedMarks"][number]) => {
    const from =
      mark.type === "fermata"
        ? index.events.get(mark.eventId)
        : mark.type === "tie"
          ? index.items.get(mark.fromItemId)
          : index.events.get(mark.fromEventId);
    const to =
      mark.type === "fermata"
        ? from
        : mark.type === "tie"
          ? index.items.get(mark.toItemId)
          : index.events.get(mark.toEventId);
    return {
      start: (from?.measureIndex ?? 0) * 1e8 + (from?.event.tick ?? 0),
      end: (to?.measureIndex ?? 0) * 1e8 + (to?.event.tick ?? 0),
    };
  };
  // 类型、内侧跨度与稳定 ID 决定排布，文档数组重排不改变几何。
  for (const mark of [...track.numberedMarks].sort(
    (a, b) =>
      (a.type === "tie" ? 0 : a.type === "fermata" ? 1 : 2) -
        (b.type === "tie" ? 0 : b.type === "fermata" ? 1 : 2) ||
      markPosition(a).end -
        markPosition(a).start -
        (markPosition(b).end - markPosition(b).start) ||
      markPosition(a).start - markPosition(b).start ||
      a.id.localeCompare(b.id),
  )) {
    if (mark.type === "fermata") {
      const event = index.events.get(mark.eventId);
      if (!event || event.measureIndex < lo || event.measureIndex > hi)
        continue;
      const cx = slots.get(mark.eventId)!.x,
        cy = allocate(cx - 8, cx + 8);
      results.push({
        markId: mark.id,
        type: mark.type,
        target: { measureId: event.measureId, eventId: event.event.id },
        path: {
          d: `M ${cx - 7} ${cy} Q ${cx} ${cy - 14} ${cx + 7} ${cy}`,
          strokeWidth: 1.2,
        },
        dots: [{ cx, cy: cy - 3, r: 1.3 }],
        lines: [],
        labels: [],
        bounds: { x: cx - 8, y: cy - 8, width: 16, height: 9 },
      });
      continue;
    }
    const from =
      mark.type === "tie"
        ? index.items.get(mark.fromItemId)
        : index.events.get(mark.fromEventId);
    const to =
      mark.type === "tie"
        ? index.items.get(mark.toItemId)
        : index.events.get(mark.toEventId);
    if (!from || !to || from.measureIndex > hi || to.measureIndex < lo)
      continue;
    let x1 = slots.get(from.event.id)?.x ?? left,
      x2 = slots.get(to.event.id)?.x ?? right;
    // 多音 Tie 端点选中实际 item 的数字中心，不默认连接音组第一项。
    if (mark.type === "tie") {
      for (const side of ["from", "to"] as const) {
        const entry =
          side === "from"
            ? index.items.get(mark.fromItemId)!
            : index.items.get(mark.toItemId)!;
        const frame = byEvent.get(entry.event.id);
        const label = frame?.labels.filter((g) => g.fontFamily !== "Bravura")[
          entry.event.items.findIndex((i) => i.id === entry.item.id)
        ];
        if (label) {
          if (side === "from") x1 = label.x;
          else x2 = label.x;
        }
      }
    }
    const limits = mark.type === "tie" ? profile.tieHeight : profile.slurHeight;
    const h = Math.min(limits[1], limits[0] + (x2 - x1) * 0.02);
    const control = h / 0.75;
    // 对称三次曲线的可见弧高为控制点抬升的 3/4；使用真实极值回算净空。
    const lift = (x: number) => {
      const t = Math.max(0, Math.min(1, (x - x1) / Math.max(1, x2 - x1)));
      return 3 * control * t * (1 - t);
    };
    const y = Math.min(
      -8,
      ...obstacles(x1, x2).map(
        (b) =>
          b.y -
          profile.markGap -
          0.5 +
          Math.min(lift(b.x), lift(b.x + b.width)),
      ),
    );
    results.push({
      markId: mark.id,
      type: mark.type,
      target: { measureId: from.measureId, eventId: from.event.id },
      path: {
        d: `M ${x1} ${y} C ${x1 + (x2 - x1) / 3} ${y - control} ${x2 - (x2 - x1) / 3} ${y - control} ${x2} ${y}`,
        strokeWidth: 1,
      },
      lines: [],
      dots: [],
      labels: [],
      bounds: {
        x: x1 - 0.5,
        y: y - h - 0.5,
        width: x2 - x1 + 1,
        height: h + 1,
      },
    });
  }
  for (const m of system.measures) {
    const source = track.measures.find((s) => s.id === m.id)!;
    for (const group of source.numberedVoice.tuplets) {
      const x1 = slots.get(group.eventIds[0]!)!.x - 5,
        x2 = slots.get(group.eventIds.at(-1)!)!.x + 5;
      const y = allocate(x1, x2, 4),
        text =
          group.ratio.actual === 3 && group.ratio.normal === 2
            ? "3"
            : `${group.ratio.actual}:${group.ratio.normal}`;
      const label = musicTextGlyph(
        musicTextRequest(text, 11),
        (x1 + x2) / 2,
        y - 2,
        metrics,
      );
      results.push({
        markId: group.id,
        type: "tuplet",
        path: {
          d: `M ${x1} ${y + 3} V ${y} H ${label.bounds.x - 3} M ${label.bounds.x + label.bounds.width + 3} ${y} H ${x2} V ${y + 3}`,
          strokeWidth: 1,
        },
        lines: [],
        dots: [],
        labels: [label],
        bounds: unionMusicBounds([
          label.bounds,
          { x: x1, y: y - 1, width: x2 - x1, height: 5 },
        ]),
      });
    }
  }
  return results;
};
/** 路径坐标用 SVG translate 统一平移，scene 同步消费变换后的路径。 */
export const translateNumberedMark = (
  mark: NumberedMarkLayout,
  dy: number,
): NumberedMarkLayout => ({
  ...mark,
  path: mark.path
    ? { ...mark.path, d: translatePathY(mark.path.d, dy) }
    : undefined,
  lines: mark.lines.map((l) => ({ ...l, y: l.y + dy })),
  dots: mark.dots.map((d) => ({ ...d, cy: d.cy + dy })),
  labels: mark.labels.map((g) => ({
    ...g,
    y: g.y + dy,
    bounds: { ...g.bounds, y: g.bounds.y + dy },
  })),
  bounds: { ...mark.bounds, y: mark.bounds.y + dy },
});
/** 仅处理本 Module 产生的绝对 M/C/Q/H/V 路径，不能修改任意外部 SVG。 */
const translatePathY = (path: string, dy: number) => {
  let command = "",
    coordinate = 0;
  return path.replace(/[MCQHV]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, (value) => {
    if (/^[MCQHV]$/i.test(value)) {
      command = value;
      coordinate = 0;
      return value;
    }
    const y = command === "V" || (command !== "H" && coordinate++ % 2 === 1);
    return String(Number(value) + (y ? dy : 0));
  });
};
