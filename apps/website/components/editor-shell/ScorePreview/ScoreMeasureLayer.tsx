import type React from "react";
import { STAFF_STRINGS } from "../editor-data";
import { MeasureDurationLayer } from "./MeasureDurationLayer";
import { MeasureGridLayer } from "./MeasureGridLayer";
import { MeasureNotesLayer } from "./MeasureNotesLayer";
import { MeasureTupletLayer } from "./MeasureTupletLayer";
import type { ScoreMeasureLayerProps } from "./score-preview-types";
import styles from "./index.module.scss";

/**
 * 小节层只负责小节外壳和局部坐标系里的固定框架：
 * - 小节号 / 拍号
 * - 六根弦线
 * - barline
 * - 当前激活格
 *
 * 真正的内容层继续向下拆成 duration / notes / tuplet，
 * 这样后续加歌词、和弦图时不会再把所有 JSX 重新堆回一个文件。
 */
export const ScoreMeasureLayer: React.FC<ScoreMeasureLayerProps> = ({
  measure,
  selection,
}) => {
  /*
   * 选区状态在容器层只保留稳定 id。
   * 这里把它重新映射回当前小节内的 beat，方便激活格按 layout 坐标直接落位。
   */
  const activeBeat =
    selection.activeMeasureId === measure.id
      ? measure.beats.find((beat) => beat.id === selection.activeBeatId)
      : undefined;
  const activeSlot =
    selection.activeMeasureId === measure.id
      ? measure.editGrid?.slots.find((slot) => slot.id === selection.activeSlotId)
      : undefined;

  return (
    <g aria-label={`第 ${measure.number} 小节`}>
      {/* TODO 这里到时候放和弦图 */}
      <text
        className={styles["measure-number-svg"]}
        x={measure.x + measure.width / 2}
        y={measure.y + 18}
      >
        {measure.number}
      </text>
      {measure.showTimeSignature ? (
        <text
          className={styles["time-signature-svg"]}
          x={measure.x - 28}
          y={measure.y + measure.staffTop + 15}
        >
          <tspan x={measure.x - 28} dy={0}>
            {measure.timeSignature.numerator}
          </tspan>
          <tspan x={measure.x - 28} dy={22}>
            {measure.timeSignature.denominator}
          </tspan>
        </text>
      ) : null}

      {STAFF_STRINGS.map((stringIndex) => (
        <line
          className={styles["staff-line-svg"]}
          key={`${measure.id}-${stringIndex}`}
          x1={measure.x}
          x2={measure.x + measure.width}
          y1={
            measure.y + measure.staffTop + (stringIndex - 1) * measure.stringSpacing
          }
          y2={
            measure.y + measure.staffTop + (stringIndex - 1) * measure.stringSpacing
          }
        />
      ))}

      <MeasureGridLayer
        activeSlotId={
          selection.activeMeasureId === measure.id
            ? selection.activeSlotId
            : undefined
        }
        measure={measure}
      />

      {(activeSlot ?? activeBeat) && selection.activeString ? (
        <rect
          className={styles["active-cell-svg"]}
          x={
            (activeSlot
              ? activeSlot.x + activeSlot.width / 2
              : activeBeat?.x ?? measure.x) - 13
          }
          y={
            measure.y +
            measure.staffTop +
            (selection.activeString - 1) * measure.stringSpacing -
            9
          }
          width={26}
          height={18}
          rx={5}
        />
      ) : null}

      <line
        className={styles["barline-svg"]}
        x1={measure.x}
        x2={measure.x}
        y1={measure.y + measure.staffTop}
        y2={measure.y + measure.staffTop + measure.staffHeight}
      />
      <line
        className={
          measure.barline === "final"
            ? `${styles["barline-svg"]} ${styles["barline-final-svg"]}`
            : styles["barline-svg"]
        }
        x1={measure.x + measure.width}
        x2={measure.x + measure.width}
        y1={measure.y + measure.staffTop}
        y2={measure.y + measure.staffTop + measure.staffHeight}
      />

      <MeasureDurationLayer measure={measure} />
      <MeasureNotesLayer measure={measure} activeNoteId={selection.activeNoteId} />
      <MeasureTupletLayer measure={measure} />
    </g>
  );
};
