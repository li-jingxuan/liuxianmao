import type React from "react";
import type { LaidOutMeasure } from "@liuxianmao/lxm-tabeditor";
import sharedStyles from "../shared.module.scss";
import styles from "./index.module.scss";

/**
 * 音符/休止符层只处理“字形本身”的绘制。
 * 这样激活态、ghost note 样式和 rest 符号可以集中维护，不和时值层互相缠绕。
 */
export const MeasureNotesLayer: React.FC<{
  measure: LaidOutMeasure;
  activeNoteId?: string;
}> = ({ measure, activeNoteId }) => (
  <>
    {measure.notes.map((note) => (
      <g key={note.id}>
        <text
          className={
            note.id === activeNoteId
              ? `${styles["fret-note-svg"]} ${styles["active-note-svg"]}`
              : note.ghost
                ? `${styles["fret-note-svg"]} ${styles["ghost-note-svg"]}`
                : styles["fret-note-svg"]
          }
          x={note.x}
          y={note.y + 4}
        >
          {note.fret}
        </text>
      </g>
    ))}

    {measure.rests.map((rest) => (
      <g key={rest.id}>
        <text
          className={`${styles["rest-svg"]} ${sharedStyles["music-icon"]}`}
          x={rest.x}
          y={rest.y + 8}
        >
          {rest.symbol}
        </text>
        {rest.rhythm.dots > 0 ? (
          <text
            className={styles["duration-dots-svg"]}
            x={rest.x + 15}
            y={rest.y + 2}
          >
            {".".repeat(rest.rhythm.dots)}
          </text>
        ) : null}
      </g>
    ))}
  </>
);
