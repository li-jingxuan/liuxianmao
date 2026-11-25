import { createNumberedRhythmContext } from "../../core/numbered/numbered-rhythm";
import { calculateRhythmTicks } from "../../core/rhythm/rhythm";
import { TICKS_PER_QUARTER } from "../../core/constants";
import type { ILXMMeasure } from "../../core/types";
import type { ILXMMeasureLayout } from "../layout-types";
import type { NumberedLayout } from "./numbered-notation-layout";
import { musicTextInkBounds, unionMusicBounds } from "./music-text-metrics";
import { LXM_NUMBERED_REDUCTION_LINE_CLEARANCE } from "../layout-constants";
import {
  numberedReductionExtent,
  numberedReductionGroups,
  numberedReductionLevels,
} from "./numbered-reduction-groups";
/** 独立简谱时值图元；减时线在数字下方，低音点置于最后一层下面。 */
export const layoutNumberedRhythm = (
  source: ILXMMeasure,
  layout: ILXMMeasureLayout,
  frames: NumberedLayout[],
  context = createNumberedRhythmContext(source.numberedVoice),
): NumberedLayout[] => {
  const events = source.numberedVoice.events;
  const timeAnchors = new Map(layout.timeAnchors.map((anchor) => [anchor.tick, anchor.x]));
  const eventSlots = new Map(layout.numberedSlots.map((slot) => [slot.id, slot]));
  const measureEnd = layout.timeAnchors.at(-1)!.tick;
  const byId = new Map(frames.map((f) => [f.eventId, f]));
  const baseY =
    Math.max(
      0,
      ...frames.flatMap((f) =>
        f.labels
          .filter((g) => g.fontFamily !== "Bravura")
          .map((g) => {
            const ink = musicTextInkBounds(g);
            return ink.y + ink.height;
          }),
      ),
    ) + LXM_NUMBERED_REDUCTION_LINE_CLEARANCE + 1.1 / 2;
  for (const event of events) {
    const n = byId.get(event.id);
    if (!n) continue;
    const level = numberedReductionLevels[event.rhythm.base];
    const body = n.labels.filter((g) => g.fontFamily !== "Bravura");
    const { left, right } = numberedReductionExtent(n);
    n.lines = Array.from({ length: level }, (_, i) => ({
      x1: left,
      x2: right,
      y: baseY + i * 3,
      thickness: 1.1,
    }));
    n.dots = n.dots.map((d) => {
      if (d.cy <= 0 || level === 0) return d;
      const digit = body.find((g) => g.x === d.cx)!;
      const ink = musicTextInkBounds(digit);
      // 只避让本音符的减时线；其它音符的三层连梁不能把低音点一起向下推。
      const lineBottom = baseY + (level - 1) * 3 + 1.1 / 2;
      return { ...d, cy: d.cy + Math.max(0, lineBottom - (ink.y + ink.height)) };
    });
    n.rhythmDots = [];
    const duration = context.getEventDurationTicks(event),
      written = calculateRhythmTicks(event.rhythm);
    let dotX = right + 4;
    if (duration.ok && written.ok && written.ticks > TICKS_PER_QUARTER) {
      const units = written.ticks / TICKS_PER_QUARTER;
      // 长时值图元属于起音小节。跨小节实际时长由轨道计时保留，绘制只使用本小节可见槽宽。
      const visibleTicks = Math.min(duration.ticks, measureEnd - event.tick);
      const slot = eventSlots.get(event.id)!;
      for (let i = 1; i < Math.floor(units); i++) {
        const tick = event.tick + (visibleTicks * i) / units;
        const cx = timeAnchors.get(tick) ?? slot.x + (slot.width * i) / units;
        n.lines.push({
          x1: cx - 5,
          x2: cx + 5,
          y: -4,
          thickness: event.kind === "rest" ? 0 : 1.2,
        });
        // 长休止由重复 0 表达，不使用延时横线。
        if (event.kind === "rest")
          n.labels.push({
            ...body[0]!,
            x: cx,
            bounds: { ...body[0]!.bounds, x: cx - body[0]!.bounds.width / 2 },
          });
        dotX = cx + 9;
      }
      const fraction = units - Math.floor(units);
      const count = fraction === 0.5 ? 1 : fraction === 0.75 ? 2 : 0;
      n.rhythmDots = Array.from({ length: count }, (_, i) => ({
        cx: dotX + i * 4,
        cy: -4,
        r: 1.3,
      }));
    } else
      n.rhythmDots = Array.from({ length: event.rhythm.dots }, (_, i) => ({
        cx: dotX + i * 4,
        cy: -4,
        r: 1.3,
      }));
    // 低音点避开减时线之后，再更新每个 item 的命中范围；升降号也属于该音符。
    n.itemBounds = n.itemBounds?.map((item, i) => ({
      ...item,
      bounds: unionMusicBounds([
        body[i]!.bounds,
        ...n.labels
          .filter(
            (g) => g.fontFamily === "Bravura" && g.x === body[i]!.bounds.x - 5,
          )
          .map((g) => g.bounds),
        ...n.dots
          .filter((d) => d.cx === body[i]!.x)
          .map((d) => ({
            x: d.cx - d.r,
            y: d.cy - d.r,
            width: d.r * 2,
            height: d.r * 2,
          })),
      ]),
    }));
  }
  // 逐层合并 notes/rest；gap、continuation、隐式空白与不同实际拍组断开。
  const coveredLines = new Set<NonNullable<NumberedLayout["lines"]>[number]>();
  numberedReductionGroups(source, context).forEach((groups, layer) => {
    for (const group of groups) {
      if (group.length > 1) {
        const first = byId.get(group[0]!.id)!,
          last = byId.get(group.at(-1)!.id)!;
        const firstLine = first.lines![layer]!,
          lastLine = last.lines![layer]!;
        first.lines!.push({
          x1: firstLine.x1,
          x2: lastLine.x2,
          y: baseY + layer * 3,
          thickness: 1.1,
          shared: true,
        });
        for (const event of group)
          coveredLines.add(byId.get(event.id)!.lines![layer]!);
      }
    }
  });
  for (const n of frames) {
    // 命中范围仍包含每个音符自身的减时线，不扩张到整条公共连梁。
    n.bounds = unionMusicBounds([
      ...n.labels.map((g) => g.bounds),
      ...[...n.dots, ...(n.rhythmDots ?? [])].map((d) => ({
        x: d.cx - d.r,
        y: d.cy - d.r,
        width: d.r * 2,
        height: d.r * 2,
      })),
      ...n
        .lines!.filter((l) => !l.shared)
        .map((l) => ({
          x: l.x1,
          y: l.y - l.thickness / 2,
          width: l.x2 - l.x1,
          height: l.thickness,
        })),
    ]);
    // 所有层合并完成后再移除被公共线覆盖的局部线，保持扫描时的层索引稳定。
    n.lines = n.lines!.filter((line) => !coveredLines.has(line));
  }
  return frames;
};
