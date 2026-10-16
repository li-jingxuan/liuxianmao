"use client";

import { useMemo } from "react";
import { buildLayout, type ILXMLayout } from "@liuxianmao/lxm-editor";
import type { ScoreExampleRef } from "../../lib/guitar-advanced/model";
import { resolveScoreExample } from "../../lib/guitar-advanced/score-example-adapter";
import { ScoreMusicLayer } from "../EditorShell/ScoreMusicLayer";
import { buildScoreScene } from "../EditorShell/score-scene";
import styles from "./TheoryLessonView.module.scss";

/** 理论谱例只准备成品 SVG，不创建 EditorSession，避免污染编辑器状态。 */
export const GuitarScoreExample = ({
  reference,
}: {
  reference: ScoreExampleRef;
}) => {
  const resolved = useMemo(() => resolveScoreExample(reference), [reference]);
  const layout = useMemo<ILXMLayout | null>(
    () =>
      resolved.ok
        ? buildLayout(resolved.document, {
            purpose: "presentation",
            systemWidth: 720,
            density: "compact",
            showChordDiagrams: false,
          })
        : null,
    [resolved],
  );
  const scene = useMemo(
    () => (layout ? buildScoreScene(layout) : null),
    [layout],
  );

  if (!resolved.ok)
    return (
      <div className={styles.scoreError}>
        谱例暂时无法加载：{resolved.error}
      </div>
    );
  if (!layout || !scene)
    return <div className={styles.scoreError}>谱例布局暂时无法生成。</div>;

  return (
    <div className={styles.scoreExample} aria-label={reference.title}>
      <svg
        className={styles.scoreSvg}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={reference.title}
      >
        <rect width={layout.width} height={layout.height} fill="#fff" />
        <ScoreMusicLayer scene={scene} />
      </svg>
      <p>{reference.caption}</p>
    </div>
  );
};
