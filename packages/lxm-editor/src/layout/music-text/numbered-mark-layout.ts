import { buildNumberedIndex } from "../../core/numbered/numbered-rhythm";
import type { ILXMTrack } from "../../core/types";
import type { ILXMBarlinePartLayout, ILXMSystemLayout } from "../layout-types";
import type { NumberedLayout } from "./numbered-notation-layout";
import {
  numberedLayoutProfile,
  type NumberedLayoutProfile,
} from "./numbered-layout-profile";
import {
  musicTextGlyph,
  musicTextInkBounds,
  numberedTupletMeasureRequest,
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

/** 从小节线墨迹的内侧边缘量留白，反复线的圆点也计入。 */
const barlineInkEdge = (part: ILXMBarlinePartLayout, inward: 1 | -1) =>
  part.kind === "line"
    ? part.x + (inward * part.strokeWidth) / 2
    : part.cx + inward * part.radius;

/**
 * 弧端常态内缩 5 个逻辑单位。窄位取余量的一半，把另一半留给从音符到行边的弧段。
 * 多音数字若已进入复合线组的横向范围，改用谱行外边界计算可用宽度，保留数字中心和弧线方向。
 */
const continuationX = (
  inkEdge: number,
  rowEdge: number,
  noteX: number | undefined,
  inward: 1 | -1,
) => {
  if (noteX === undefined) return inkEdge + inward * 5;
  const edge = (noteX - inkEdge) * inward > 0 ? inkEdge : rowEdge;
  const available = Math.max(0, (noteX - edge) * inward);
  return edge + inward * Math.min(5, available / 2);
};

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
  // 普通行首沿用最左收边线，行首反复线和行末小节线使用实际投影，而非配置行宽。
  // 再计半个弧线宽度，保证端点靠边时其描边也留在边线内侧。
  const lastMeasure = system.measures.at(-1)!;
  const rowLeft = system.x + 1.5;
  const rowRight = lastMeasure.x + lastMeasure.width - 0.5;
  const leftInk = Math.max(
    rowLeft,
    ...(system.header.leadingBarline?.parts ?? []).map(
      (p) => barlineInkEdge(p, 1) + 0.5,
    ),
  );
  const rightInk = Math.min(
    rowRight,
    ...lastMeasure.barline.parts.map((p) => barlineInkEdge(p, -1) - 0.5),
  );
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
    let fromX = slots.get(from.event.id)?.x,
      toX = slots.get(to.event.id)?.x;
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
          if (side === "from") fromX = label.x;
          else toX = label.x;
        }
      }
    }
    const x1 = fromX ?? continuationX(leftInk, rowLeft, toX, 1);
    const x2 = toX ?? continuationX(rightInk, rowRight, fromX, -1);
    const span = x2 - x1;
    const outgoing = fromX !== undefined && toX === undefined;
    const incoming = fromX === undefined && toX !== undefined;
    const limits = mark.type === "tie" ? profile.tieHeight : profile.slurHeight;
    const naturalHeight = Math.min(limits[1], limits[0] + span * 0.02);
    const h =
      outgoing || incoming
        ? Math.min(naturalHeight, span * 0.35)
        : fromX === undefined
          ? Math.min(2, span * 0.02)
          : naturalHeight;
    const control = h / 0.75;
    // 换行端与相邻控制点同高，向小节线延伸时切线保持水平。没有音符端点的中间行用浅弧。
    // 同行仍用原来的对称弧，可见弧高为控制点抬升的 3/4。
    const startLift = incoming ? h : 0;
    const endLift = outgoing ? h : 0;
    const leftControl = incoming ? h : outgoing ? h * 0.8 : control;
    const rightControl = outgoing ? h : incoming ? h * 0.8 : control;
    const liftSpan = Math.max(incoming || outgoing ? Number.EPSILON : 1, span);
    const lift = (x: number) => {
      const t = Math.max(0, Math.min(1, (x - x1) / liftSpan));
      if (!incoming && !outgoing) return 3 * control * t * (1 - t);
      // 控制点横向等分，直接按 x 求参数。半弧的抬升单调，取障碍物两侧较低处确保净空。
      const u = 1 - t;
      return (
        startLift * u ** 3 +
        3 * leftControl * u ** 2 * t +
        3 * rightControl * u * t ** 2 +
        endLift * t ** 3
      );
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
        d: `M ${x1} ${y - startLift} C ${x1 + span / 3} ${y - leftControl} ${x2 - span / 3} ${y - rightControl} ${x2} ${y - endLift}`,
        strokeWidth: 1,
      },
      lines: [],
      dots: [],
      labels: [],
      bounds: {
        x: x1 - 0.5,
        y: y - h - 0.5,
        width: span + 1,
        height: h + 1,
      },
    });
  }
  // 组保存在起音小节。实际末音在次小节时，同一行仍画一个数字与完整弧线；换行后只在起音行标号。
  for (const source of track.measures.slice(Math.max(0, lo - 1), hi + 1)) {
    for (const group of source.numberedVoice.tuplets) {
      const firstId = group.eventIds[0]!;
      const lastId = group.eventIds.at(-1)!;
      const start = index.events.get(firstId);
      const end = index.events.get(lastId);
      if (!start || !end || start.measureIndex > hi || end.measureIndex < lo) continue;
      const firstSlot = slots.get(firstId);
      const lastSlot = slots.get(lastId);
      if (!firstSlot) {
        // 续入端贴近行首；保留同一组 ID 供编辑谱面和图片、打印场景关联。
        const x2 = Math.max(left + 4, (lastSlot?.x ?? right) + 5);
        const y = allocate(left, x2);
        const h = Math.min(profile.slurHeight[1], profile.slurHeight[0] + (x2 - left) * 0.02);
        results.push({
          markId: group.id,
          type: "tuplet",
          path: { d: `M ${left} ${y - h} Q ${(left + x2) / 2} ${y - h} ${x2} ${y}`, strokeWidth: 1 },
          lines: [], dots: [], labels: [],
          bounds: { x: left - 0.5, y: y - h - 0.5, width: x2 - left + 1, height: h + 1 },
        });
        continue;
      }
      const firstX = firstSlot.x;
      const lastX = lastSlot?.x ?? Math.max(firstX, right - 5);
      const request = numberedTupletMeasureRequest(group.ratio);
      const ink = musicTextInkBounds(musicTextGlyph(request, 0, 0, metrics));
      // 按字形墨迹给断口留白；比例文字较宽时对称扩展跨度，保证两侧仍有可见的弧段。
      const halfGap = Math.max(-ink.x, ink.x + ink.width) + 2;
      const halfSpan = Math.max((lastX - firstX) / 2 + 5, halfGap + 4);
      const midpoint = (firstX + lastX) / 2;
      const centerX = lastSlot ? midpoint : Math.min(midpoint, right - halfSpan);
      const x1 = centerX - halfSpan;
      const x2 = centerX + halfSpan;
      const h = Math.min(
        profile.slurHeight[1],
        profile.slurHeight[0] + (x2 - x1) * 0.02,
      );
      // 弧端和居中的文字共同参与净空计算，兼容字体度量尚未加载的情况。
      const y = allocate(x1, x2, Math.max(0.5, ink.height / 2 - h));
      const apexY = y - h;
      const label = musicTextGlyph(
        request,
        centerX,
        apexY - ink.y - ink.height / 2,
        metrics,
      );
      // 从同一条抛物线截取左右两段，断口边缘保留原弧的斜率，数字置于弧顶。
      const gapRatio = halfGap / halfSpan;
      const gapY = apexY + h * gapRatio ** 2;
      const controlY = apexY + h * gapRatio;
      const leftGapX = centerX - halfGap;
      const rightGapX = centerX + halfGap;
      // 换行的右端水平伸出；与次行从边缘接回末音的弧段对应。
      const rightEndY = lastSlot ? y : gapY;
      const rightControlY = lastSlot ? controlY : gapY;
      results.push({
        markId: group.id,
        type: "tuplet",
        path: {
          d: `M ${x1} ${y} Q ${(x1 + leftGapX) / 2} ${controlY} ${leftGapX} ${gapY} M ${rightGapX} ${gapY} Q ${(rightGapX + x2) / 2} ${rightControlY} ${x2} ${rightEndY}`,
          strokeWidth: 1,
        },
        lines: [],
        dots: [],
        labels: [label],
        bounds: unionMusicBounds([
          label.bounds,
          {
            x: x1 - 0.5,
            y: gapY - 0.5,
            width: x2 - x1 + 1,
            height: y - gapY + 1,
          },
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
