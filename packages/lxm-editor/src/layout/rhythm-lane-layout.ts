import type { ILXMMeasure } from "../core/types";
import type { ILXMMeasureLayout } from "./layout-types";
import {
  resolveDurationBeamOffset,
  translateDurationBaseline,
} from "./duration-beam-layout";
import { calculateMeasureHeight } from "./layout-helpers";
import { getRhythmBottom } from "./rhythm-bounds";
import { layoutTuplets } from "./tuplet-layout";
import { LXM_TUPLET_BOTTOM_PADDING } from "./layout-constants";

/** 分行后取最大所需净空统一节奏基线，再重建连音及高度，避免同行各小节上下跳动。 */
export const alignSystemRhythm = (
  sources: readonly ILXMMeasure[],
  measures: ILXMMeasureLayout[],
): ILXMMeasureLayout[] => {
  const offset = Math.max(0, ...measures.map(resolveDurationBeamOffset));
  return measures.map((measure, index) => {
    if (!measure.durationMarks.length) return measure;
    const sixthStringY = measure.strings.find((line) => line.index === 6)!.y1;
    const currentOffset = measure.durationMarks[0]!.beamY - sixthStringY;
    const duration = translateDurationBaseline(measure, offset - currentOffset);
    const tuplets = layoutTuplets(
      sources[index]!,
      measure.beats,
      duration.beamSegments,
      duration.durationMarks,
      measure.restMarks,
      measure.strings,
    );
    return {
      ...measure,
      ...duration,
      tuplets,
      height: Math.max(
        calculateMeasureHeight(
          measure.y,
          getRhythmBottom(
            measure.strings,
            duration.beamSegments,
            duration.durationMarks,
            measure.restMarks,
          ),
        ),
        ...tuplets.map(
          (group) => group.label.y + LXM_TUPLET_BOTTOM_PADDING - measure.y,
        ),
      ),
    };
  });
};
