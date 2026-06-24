import type React from "react";
import type { LaidOutMeasure } from "@liuxianmao/lxm-tabeditor";
import styles from "./index.module.scss";

/**
 * 占位网格层只渲染 layout 派生的 editGrid，不读取或修改真实 score。
 *
 * slot 的 x/width 已经在 layout 层按当前编辑时值算好；页面层只负责表达三种视觉态：
 * - active：当前光标所在 slot；
 * - occupied：真实 beat 起点；
 * - empty：长 beat 内部派生出的可输入空槽。
 */
export const MeasureGridLayer: React.FC<{
  measure: LaidOutMeasure;
  activeSlotId?: string;
}> = ({ measure, activeSlotId }) => (
  <>
    {measure.editGrid?.slots.map((slot) => (
      <rect
        className={
          slot.id === activeSlotId
            ? styles["active-grid-slot-svg"]
            : slot.beatId
              ? styles["occupied-grid-slot-svg"]
              : styles["empty-grid-slot-svg"]
        }
        height={measure.staffHeight + 12}
        key={slot.id}
        rx={2}
        width={Math.max(1, slot.width)}
        x={slot.x}
        y={measure.y + measure.staffTop - 6}
      />
    ))}
  </>
);
