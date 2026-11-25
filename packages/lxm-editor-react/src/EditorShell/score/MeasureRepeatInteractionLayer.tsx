import type { ILXMLayout } from "@liuxianmao/lxm-editor";
import styles from "./MeasureRepeatInteractionLayer.module.scss";

/** 用布局输出的整节区域开启属性面板，缩写下的快照拍不参与编辑命中。 */
export const MeasureRepeatInteractionLayer = ({ layout, activeMeasureId, onEdit }: {
  layout: ILXMLayout;
  activeMeasureId?: string;
  onEdit: (measureId: string) => void;
}) => (
  <g data-layer="measure-repeat-interaction">
    {layout.systems.flatMap((system) => system.measures.flatMap((measure) => measure.measureRepeat ? [
      <rect
        key={measure.id}
        {...measure.measureRepeat.bounds}
        data-measure-repeat-target={measure.id}
        aria-pressed={activeMeasureId === measure.id}
        className={styles.target}
        rx={3}
        role="button"
        tabIndex={0}
        fill="transparent"
        aria-label={`编辑第 ${measure.index + 1} 小节的单小节重复`}
        onPointerDown={(event) => {
          // 只消费左键选取，右键保留给共用的谱面上下文入口。
          if (event.button === 0) event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(measure.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.stopPropagation();
          event.preventDefault();
          if (!event.repeat) onEdit(measure.id);
        }}
      />,
    ] : []))}
  </g>
);
