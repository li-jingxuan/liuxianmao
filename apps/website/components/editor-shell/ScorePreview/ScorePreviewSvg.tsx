import type React from "react";
import { ScoreSystemLayer } from "./ScoreSystemLayer";
import type { ScorePreviewSvgProps } from "./score-preview-types";
import styles from "./index.module.scss";

/**
 * SVG 外壳层只负责谱面根节点和 system 遍历。
 * 这里不理解小节内部细节，避免顶层组件再次膨胀回“大而全”的渲染文件。
 */
export const ScorePreviewSvg: React.FC<ScorePreviewSvgProps> = ({
  layout,
  title,
  selection,
  svgRef,
  onPointerDown,
}) => (
  <svg
    className={styles["score-svg"]}
    onPointerDown={onPointerDown}
    ref={svgRef}
    role="img"
    aria-label={title}
    viewBox={`0 0 ${layout.width} ${layout.height}`}
    width={layout.width * layout.zoom}
    height={layout.height * layout.zoom}
  >
    {layout.systems.map((system) => (
      /*
       * layout 已经产出绝对 SVG 坐标，React 层只消费坐标结果。
       * 这里不再做额外 transform，避免命中坐标和实际绘制位置产生偏移。
       */
      <ScoreSystemLayer
        key={system.index}
        systemIndex={system.index}
        /*
         * tie 已经在 layout 层拆成 segment。
         * 这里按 system 过滤后下发，保证 system 子组件不需要再理解整首谱的跨行关系。
         */
        ties={layout.ties.flatMap((tie) =>
          tie.segments.filter((segment) => segment.systemIndex === system.index),
        )}
        measures={system.measures}
        selection={selection}
      />
    ))}
  </svg>
);
