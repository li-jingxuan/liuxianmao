import { Fragment, memo, useMemo } from "react";
import { getMeasureCapacityTicks, type ILXMLayout, type ILXMMeasure } from "@liuxianmao/lxm-editor";
import { formatMeasureDuration } from "../shared/measure-duration";
import styles from "./score-interaction.module.scss";

const MEASURE_NUMBER_FONT_SIZE = 8;

export const MeasureNumberLayer = memo(function MeasureNumberLayer({ layout, activeMeasureId, editingMeasures }: {
  layout: ILXMLayout;
  activeMeasureId?: string;
  editingMeasures?: ILXMMeasure[];
}) {
  const numbers = useMemo(() => layout.systems.flatMap((system) =>
    system.measures.map((measure) => {
      const topString = measure.strings[0]!;
      const lines = measure.barline.parts.filter((part) => part.kind === "line");
      // 额外拍数只随编辑图层绘制；打印、图片和只读试听均使用原谱的拍号及小节线。
      const source = editingMeasures?.[measure.index];
      const duration = source?.actualDurationTicks;
      // 共用边界有跳转落点时，沿用核心算好的避让坐标；其余小节号保留原锚点。
      const position = measure.numberPosition;
      return {
        id: measure.id,
        text: measure.index + 1,
        durationLabel: duration !== undefined && source && duration < getMeasureCapacityTicks(source.timeSignature)
          ? `实际 ${formatMeasureDuration(duration)}` : undefined,
        x: position?.x ?? (lines.length ? Math.max(...lines.map((line) => line.x)) : topString.x2),
        y: position?.y ?? topString.y1 - 1,
      };
    }),
  ), [layout, editingMeasures]);
  return (
    <g className={styles.measureNumbers} data-layer="measure-numbers" pointerEvents="none" aria-hidden="true">
      {numbers.map(({ id, text, x, y, durationLabel }) => (
        <Fragment key={id}>
          {durationLabel && (
            <text data-measure-duration={id} className={styles.durationLabel}
              x={x - 7} y={y} fontSize={MEASURE_NUMBER_FONT_SIZE} textAnchor="end">
              {durationLabel}
            </text>
          )}
          <text
            data-measure-number={id}
            data-active={id === activeMeasureId ? "true" : undefined}
            x={x}
            y={y}
            fontSize={MEASURE_NUMBER_FONT_SIZE}
            textAnchor="middle"
          >
            {text}
          </text>
        </Fragment>
      ))}
    </g>
  );
});
