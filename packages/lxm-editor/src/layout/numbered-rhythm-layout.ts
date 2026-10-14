import { createNumberedRhythmContext } from "../core/numbered-rhythm";
import {
  calculateRhythmTicks,
  getTimeSignatureBeatGroupTicks,
} from "../core/rhythm";
import { TICKS_PER_QUARTER } from "../core/constants";
import type { ILXMMeasure, ILXMRhythmBase } from "../core/types";
import type { ILXMMeasureLayout } from "./layout-types";
import type { NumberedLayout } from "./numbered-notation-layout";
import { unionMusicBounds } from "./music-text-metrics";
const levels: Record<ILXMRhythmBase, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtySecond: 3,
};
/** 独立简谱时值图元；减时线在数字下方，低音点置于最后一层下面。 */
export const layoutNumberedRhythm = (
  source: ILXMMeasure,
  layout: ILXMMeasureLayout,
  frames: NumberedLayout[],
): NumberedLayout[] => {
  const context = createNumberedRhythmContext(source.numberedVoice);
  const events = source.numberedVoice.events;
  const timeAnchors = new Map(layout.timeAnchors.map((a) => [a.tick, a.x]));
  const eventSlots = new Map(layout.numberedSlots.map((s) => [s.id, s]));
  const byId = new Map(frames.map((f) => [f.eventId, f]));
  const baseY =
    Math.max(
      0,
      ...frames.flatMap((f) =>
        f.labels
          .filter((g) => g.fontFamily !== "Bravura")
          .map((g) => g.bounds.y + g.bounds.height),
      ),
    ) + 3;
  const maxLevel = Math.max(0, ...events.map((e) => levels[e.rhythm.base]));
  const groupTicks = getTimeSignatureBeatGroupTicks(source.timeSignature) ?? [
    Infinity,
  ];
  const groupIndex = (tick: number) => {
    let sum = 0;
    for (let i = 0; i < groupTicks.length; i++) {
      sum += groupTicks[i]!;
      if (tick < sum) return i;
    }
    return groupTicks.length;
  };
  for (const event of events) {
    const n = byId.get(event.id);
    if (!n) continue;
    const level = levels[event.rhythm.base];
    const body = n.labels.filter((g) => g.fontFamily !== "Bravura");
    const left = Math.min(...body.map((g) => g.bounds.x)) - 1,
      right = Math.max(...body.map((g) => g.bounds.x + g.bounds.width)) + 1;
    n.lines = Array.from({ length: level }, (_, i) => ({
      x1: left,
      x2: right,
      y: baseY + i * 3,
      thickness: 1.1,
    }));
    n.dots = n.dots.map((d) =>
      d.cy > 0
        ? {
            ...d,
            cy:
              baseY +
              Math.max(0, maxLevel - 1) * 3 +
              4 +
              Math.max(
                0,
                d.cy -
                  (Math.max(...body.map((g) => g.bounds.y + g.bounds.height)) +
                    4),
              ),
          }
        : d,
    );
    n.rhythmDots = [];
    const duration = context.getEventDurationTicks(event),
      written = calculateRhythmTicks(event.rhythm);
    const anchors = timeAnchors;
    let dotX = right + 4;
    if (duration.ok && written.ok && written.ticks > TICKS_PER_QUARTER) {
      const units = written.ticks / TICKS_PER_QUARTER;
      for (let i = 1; i < Math.floor(units); i++) {
        const tick = event.tick + (duration.ticks * i) / units;
        const cx =
          anchors.get(tick) ??
          eventSlots.get(event.id)!.x +
            (eventSlots.get(event.id)!.width * i) / units;
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
  // 逐层合并连续成员；gap、休止与不同实际拍组中断共享连梁。
  for (let level = 1; level <= 3; level++) {
    let group: typeof events = [];
    const flush = () => {
      if (group.length > 1) {
        const first = byId.get(group[0]!.id)!,
          last = byId.get(group.at(-1)!.id)!;
        const firstLine = first.lines![level - 1]!,
          lastLine = last.lines![level - 1]!;
        first.lines!.push({
          x1: firstLine.x1,
          x2: lastLine.x2,
          y: baseY + (level - 1) * 3,
          thickness: 1.1,
          shared: true,
        });
      }
      group = [];
    };
    for (const e of events) {
      const previous = group.at(-1);
      const oldDuration = previous && context.getEventDurationTicks(previous);
      const currentGroup = context.tupletByEventId.get(e.id)?.id;
      const previousGroup =
        previous && context.tupletByEventId.get(previous.id)?.id;
      if (e.kind !== "notes" || levels[e.rhythm.base] < level) {
        flush();
        continue;
      }
      if (
        previous &&
        (!oldDuration?.ok ||
          previous.tick + oldDuration.ticks !== e.tick ||
          currentGroup !== previousGroup ||
          (!currentGroup && groupIndex(previous.tick) !== groupIndex(e.tick)))
      )
        flush();
      group.push(e);
    }
    flush();
  }
  for (const n of frames)
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
  return frames;
};
