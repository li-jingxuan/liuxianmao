import type React from "react";
import {
  isLaidOutPartialBeam,
  isLaidOutSharedBeam,
  type LaidOutMeasure,
} from "@liuxianmao/lxm-tabeditor";
import { getDurationFlagPath } from "./score-preview-paths";
import styles from "./index.module.scss";

/**
 * 时值层只消费 layout 产出的时值几何：
 * - beamSegments：共享连梁和 partial beam
 * - durationMarks：符干、符尾、附点
 *
 * 页面层不重新推导节奏关系，只做“按坐标绘制”。
 */
export const MeasureDurationLayer: React.FC<{
  measure: LaidOutMeasure;
}> = ({ measure }) => {
  if(measure.id === 'measure-005') {
    console.log('measure: ', measure);
  }
  
  return (
    <>
      {/* 连梁 */}
      {measure.beamSegments.map((beamSegment) => {
        const key = isLaidOutSharedBeam(beamSegment)
          ? `${measure.id}-beam-shared-${beamSegment.level}-${beamSegment.beatIds.join("-")}`
          : `${measure.id}-beam-partial-${beamSegment.beatId}-${beamSegment.level}`;

        return (
          <rect
            className={styles["duration-beam-svg"]}
            height={2}
            key={key}
            width={Math.max(0, beamSegment.x2 - beamSegment.x1)}
            x={beamSegment.x1}
            y={beamSegment.y - 1.2}
          />
        );
      })}

      {measure.durationMarks.map((mark) => {
        /*
        * 如果某一层级已经被 beam 覆盖，就不再额外画 flag。
        * 否则同一个 beat 会同时出现连梁和符尾，视觉上重复。
        */
        const coveredBeamLevels = new Set(
          measure.beamSegments
            .filter(
              (beamSegment) =>
                (isLaidOutSharedBeam(beamSegment) &&
                  beamSegment.beatIds.includes(mark.beatId)) ||
                (isLaidOutPartialBeam(beamSegment) &&
                  beamSegment.beatId === mark.beatId),
            )
            .map((beamSegment) => beamSegment.level),
        );

        return (
          <g key={`${measure.id}-duration-${mark.beatId}`}>
            {/* 符干 */}
            {mark.hasStem ? (
              <line
                className={styles["duration-stem-svg"]}
                x1={mark.stemX}
                x2={mark.stemX}
                y1={mark.stemTopY}
                y2={mark.stemBottomY}
              />
            ) : null}

            {/* 时值标识 */}
            {Array.from({ length: mark.flagCount }, (_, index) => {
              const level = (index + 1) as 1 | 2 | 3;
              if (coveredBeamLevels.has(level)) return null;
              const flagAnchor = mark.flagAnchors.find(
                (anchor) => anchor.level === level,
              );
              if (!flagAnchor) return null;
              return (
                <path
                  className={styles["duration-flag-svg"]}
                  d={getDurationFlagPath(flagAnchor.x, flagAnchor.y)}
                  key={`${mark.beatId}-flag-${level}`}
                />
              );
            })}

            {/* 附点 */}
            {mark.dots > 0 ? (
              <text
                className={styles["duration-dots-svg"]}
                x={mark.dot.x}
                y={mark.dot.y}
              >
                {".".repeat(mark.dots)}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
}
