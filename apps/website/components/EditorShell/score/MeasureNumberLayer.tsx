import { memo, useMemo } from "react";
import type { ILXMLayout } from "@liuxianmao/lxm-editor";
import styles from "./score-interaction.module.scss";

const MEASURE_NUMBER_FONT_SIZE = 8;

export const MeasureNumberLayer = memo(function MeasureNumberLayer({ layout, activeMeasureId }: {
  layout: ILXMLayout;
  activeMeasureId?: string;
}) {
  const numbers = useMemo(() => layout.systems.flatMap((system) =>
    system.measures.map((measure) => {
      const topString = measure.strings[0]!;
      const lines = measure.barline.parts.filter((part) => part.kind === "line");
      return {
        id: measure.id,
        text: measure.index + 1,
        x: lines.length ? Math.max(...lines.map((line) => line.x)) : topString.x2,
        y: topString.y1 - 1,
      };
    }),
  ), [layout]);
  return (
    <g className={styles.measureNumbers} data-layer="measure-numbers" pointerEvents="none" aria-hidden="true">
      {numbers.map(({ id, text, x, y }) => (
        <text
          key={id}
          data-measure-number={id}
          data-active={id === activeMeasureId ? "true" : undefined}
          x={x}
          y={y}
          fontSize={MEASURE_NUMBER_FONT_SIZE}
          textAnchor="middle"
        >
          {text}
        </text>
      ))}
    </g>
  );
});
