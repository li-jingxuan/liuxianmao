"use client";
import { useMemo } from "react";
import type {
  GuitarAdvancedData,
  ScoreExampleRef,
} from "../../lib/guitar-advanced/model";
import { ScoreMusicLayer } from "../EditorShell/ScoreMusicLayer";
import { prepareScore, type PreparedScore } from "./score-presentation";
import styles from "./TheoryLessonView.module.scss";
export const PreparedScoreView = ({
  prepared,
  title,
  caption,
}: {
  prepared: PreparedScore;
  title: string;
  caption: string;
}) =>
  prepared.ok ? (
    <figure className={styles.scoreExample}>
      <svg
        className={styles.scoreSvg}
        viewBox={`0 0 ${prepared.layout.width} ${prepared.layout.height}`}
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        <desc>{caption}</desc>
        <rect
          width={prepared.layout.width}
          height={prepared.layout.height}
          fill="#fff"
        />
        <ScoreMusicLayer scene={prepared.scene} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  ) : (
    <div className={styles.scoreError} role="alert">
      谱例暂时无法加载：{prepared.error}
    </div>
  );
/** 只读素材不创建 EditorSession，字幕可按理论上下文覆盖。 */
export const GuitarScoreExample = ({
  reference,
  documents,
  caption,
}: {
  reference: ScoreExampleRef;
  documents: GuitarAdvancedData["teachingDocuments"];
  caption?: string;
}) => {
  const prepared = useMemo(
    () => prepareScore(reference, documents),
    [reference, documents],
  );
  return (
    <PreparedScoreView
      prepared={prepared}
      title={reference.title}
      caption={caption ?? reference.caption}
    />
  );
};
