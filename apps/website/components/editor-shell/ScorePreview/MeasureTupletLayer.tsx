import type React from "react";
import type { LaidOutMeasure } from "@liuxianmao/lxm-tabeditor";
import { getTupletBracketPath } from "./score-preview-paths";
import styles from "./index.module.scss";

/** 连音组括号单独成层，避免和 beam / note / tie 的渲染顺序互相污染。 */
export const MeasureTupletLayer: React.FC<{
  measure: LaidOutMeasure;
}> = ({ measure }) => (
  <>
    {measure.tuplets.map((tuplet) => (
      <g className={styles["tuplet-svg"]} key={tuplet.id}>
        <path d={getTupletBracketPath(tuplet)} />
        <text x={(tuplet.x1 + tuplet.x2) / 2} y={tuplet.y + 15}>
          {tuplet.number}
        </text>
      </g>
    ))}
  </>
);
