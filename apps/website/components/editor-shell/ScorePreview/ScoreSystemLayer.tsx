import type React from "react";
import { ScoreMeasureLayer } from "./ScoreMeasureLayer";
import { getTiePath } from "./score-preview-paths";
import type { ScoreSystemLayerProps } from "./score-preview-types";
import styles from "./index.module.scss";

/**
 * system 层负责“这一行谱表”的公共元素：
 * - TAB 前缀
 * - 当前行的小节集合
 * - 已经按行拆好的 tie segment
 *
 * tie 放在 system 而不是 measure，是因为它天然可能跨小节，甚至跨到下一行。
 */
export const ScoreSystemLayer: React.FC<ScoreSystemLayerProps> = ({
  systemIndex,
  ties,
  measures,
  selection,
}) => (
  <g key={systemIndex}>
    <text className={styles["tab-prefix-svg"]} x={18} y={58}>
      <tspan x={18} dy={0}>
        T
      </tspan>
      <tspan x={18} dy={18}>
        A
      </tspan>
      <tspan x={18} dy={18}>
        B
      </tspan>
    </text>

    {/* 小节集合 */}
    {measures.map((measure) => (
      <ScoreMeasureLayer
        key={measure.id}
        measure={measure}
        selection={selection}
      />
    ))}

    {/* tie segment 已经在 layout 层按 system 拆分，这里只渲染当前 system 的片段。 */}
    {ties.map((segment) => (
      <path
        key={segment.id}
        className={styles["tie-svg"]}
        d={getTiePath(segment)}
      />
    ))}
  </g>
);
