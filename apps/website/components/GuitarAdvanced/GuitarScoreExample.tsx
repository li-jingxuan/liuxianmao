"use client";
import { useMemo } from "react";
import type {
  GuitarAdvancedData,
  ScoreExampleRef,
} from "../../lib/guitar-advanced/model";
import { ScoreMusicLayer } from "../EditorShell/score/ScoreMusicLayer";
import { prepareScore, type PreparedScore } from "./score-presentation";
import styles from "./TheoryLessonView.module.scss";
/**
 * React 展示层只消费已准备的布局与纯场景：负责 SVG 容器、无障碍文本和失败提示。
 * 乐谱图元交给共享 ScoreMusicLayer，布局计算仍在 prepareScore 中完成。
 */
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
/**
 * 按引用与文档对象缓存准备结果，再交给展示层；只读素材不创建 EditorSession。
 * 字幕可按理论上下文覆盖，默认使用谱例引用自带说明。
 */
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
