import type { Measure } from "../core/schema";

export interface MeasureBreakSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
}

export interface SystemBreak {
  startMeasureIndex: number;
  endMeasureIndex: number;
  compressed: boolean;
}

export const createSystemBreaks = (
  measures: Measure[],
  summariesByMeasureId: Record<string, MeasureBreakSummary>,
  context: {
    availableWidth: number;
    forcedMeasuresPerSystem?: number;
  },
): SystemBreak[] => {
  if (context.forcedMeasuresPerSystem) {
    const breaks: SystemBreak[] = [];

    for (
      let startMeasureIndex = 0;
      startMeasureIndex < measures.length;
      startMeasureIndex += context.forcedMeasuresPerSystem
    ) {
      breaks.push({
        startMeasureIndex,
        endMeasureIndex: Math.min(
          measures.length,
          startMeasureIndex + context.forcedMeasuresPerSystem,
        ),
        compressed: false,
      });
    }

    return breaks;
  }

  const breaks: SystemBreak[] = [];
  let startMeasureIndex = 0;
  let currentIdealWidth = 0;
  let currentMinWidth = 0;
  let currentCompressed = false;

  measures.forEach((measure, measureIndex) => {
    const summary = summariesByMeasureId[measure.id];
    if (!summary) return;

    const nextIdealWidth = currentIdealWidth + summary.idealWidth;
    const nextMinWidth = currentMinWidth + summary.minWidth;
    const hasCurrentMeasures = measureIndex > startMeasureIndex;
    const fitsIdeally = nextIdealWidth <= context.availableWidth;
    const fitsMinimally = nextMinWidth <= context.availableWidth;

    /**
     * 自动分行按内容宽度贪心累加：
     * - idealWidth 可放下时直接放入当前行；
     * - idealWidth 放不下但 minWidth 可放下时也放入，后续由宽度分配压缩；
     * - 两者都放不下时换行；如果当前行为空，则超宽小节单独成行。
     */
    if (hasCurrentMeasures && !fitsIdeally && !fitsMinimally) {
      breaks.push({
        startMeasureIndex,
        endMeasureIndex: measureIndex,
        compressed: currentCompressed,
      });
      startMeasureIndex = measureIndex;
      currentIdealWidth = summary.idealWidth;
      currentMinWidth = summary.minWidth;
      currentCompressed = summary.idealWidth > context.availableWidth;
      return;
    }

    currentIdealWidth = nextIdealWidth;
    currentMinWidth = nextMinWidth;
    currentCompressed ||= !fitsIdeally && fitsMinimally;
  });

  if (startMeasureIndex < measures.length) {
    breaks.push({
      startMeasureIndex,
      endMeasureIndex: measures.length,
      compressed: currentCompressed,
    });
  }

  return breaks;
};
