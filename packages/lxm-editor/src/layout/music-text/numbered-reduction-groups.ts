import { createNumberedRhythmContext } from "../../core/numbered/numbered-rhythm";
import { getTimeSignatureBeatGroupTicks } from "../../core/rhythm/rhythm";
import type { ILXMMeasure, ILXMNumberedEvent, ILXMRhythmBase } from "../../core/types";
import { musicTextInkBounds } from "./music-text-metrics";
import type { NumberedLayout } from "./numbered-notation-layout";

export const numberedReductionLevels: Record<ILXMRhythmBase, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtySecond: 3,
};

export const NUMBERED_REDUCTION_GROUP_GAP = 3;

/** 保护框只用于命中；减时线从数字墨迹两侧各伸出 1px。 */
export const numberedReductionExtent = (frame: NumberedLayout) => {
  const body = frame.labels
    .filter((glyph) => glyph.fontFamily !== "Bravura")
    .map(musicTextInkBounds);
  return {
    left: Math.min(...body.map((ink) => ink.x)) - 1,
    right: Math.max(...body.map((ink) => ink.x + ink.width)) + 1,
  };
};

/** 绘制与硬间距共用逐层分组，休止 0 与音符遵循相同的实际时值规则。 */
export const numberedReductionGroups = (measure: ILXMMeasure, context = createNumberedRhythmContext(measure.numberedVoice)) => {
  const groupTicks = getTimeSignatureBeatGroupTicks(measure.timeSignature) ?? [Infinity];
  const groupIndex = (tick: number) => {
    let sum = 0;
    for (let i = 0; i < groupTicks.length; i++) {
      sum += groupTicks[i]!;
      if (tick < sum) return i;
    }
    return groupTicks.length;
  };
  return [1, 2, 3].map((level) => {
    const groups: ILXMNumberedEvent[][] = [];
    let group: ILXMNumberedEvent[] = [];
    const flush = () => {
      if (group.length) groups.push(group);
      group = [];
    };
    for (const event of measure.numberedVoice.events) {
      if ((event.kind !== "notes" && event.kind !== "rest") ||
          numberedReductionLevels[event.rhythm.base] < level) {
        flush();
        continue;
      }
      const previous = group.at(-1);
      if (previous) {
        const duration = context.getEventDurationTicks(previous);
        const tuplet = context.tupletByEventId.get(event.id)?.id;
        if (!duration.ok || previous.tick + duration.ticks !== event.tick ||
            tuplet !== context.tupletByEventId.get(previous.id)?.id ||
            (!tuplet && groupIndex(previous.tick) !== groupIndex(event.tick)))
          flush();
      }
      group.push(event);
    }
    flush();
    return groups;
  });
};
